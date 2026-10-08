import "server-only";
import {
  daysInclusive, kstDate, loadSecrets, NaverKeyBook, naverCall, naverMessage, pool, readData, saveRows,
  type Advertiser,
} from "./common";
import { determineStatus, prevMonthSameDay } from "./rules";

// 비즈머니 아침 확인 (예전 대시보드 api/bizmoney-snapshot.js 와 같은 계산)
//   기간: 이번 달 1일 ~ 오늘(한국). 매핑일이 더 늦으면 매핑일부터
//   광고비: 광고비 출처(auto: 네이버 → 실패하면 피이관 실적 / naver_api / transferred)
//   일평균 = 기간 광고비(VAT 포함) ÷ 일수, 잔여일 = 비즈머니 ÷ 일평균
//   위험: 잔액 10만원 이하 또는 잔여 3일 이하 / 주의: 잔액 50만원 이하 또는 잔여 7일 이하
//   전월 같은 기간 광고비(VAT 제외)도 같이 저장
//   같은 날 이미 정상 저장된 곳은 건너뜀 (force면 전부 다시)

const CONCURRENCY = 6;
const TIME_BUDGET_MS = 250_000;



type Cost = { ok: true; totalCost: number; days: number; source: "naver_api" | "transferred" } | { ok: false; message: string };

export async function runBizmoneySnapshot(token: string, opts: { force?: boolean; customerId?: string } = {}) {
  const started = Date.now();
  const today = kstDate(0);
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevStart = prevMonthSameDay(monthStart);

  const [secrets, advertisers, transferred, doneList] = await Promise.all([
    loadSecrets(token),
    readData<Advertiser[]>(token, "advertisers"),
    readData<{ customer_id: string; stat_date: string; paid_cost: number }[]>(token, "transferred", { from: prevStart, to: today }),
    opts.force || opts.customerId ? Promise.resolve([] as string[]) : readData<string[]>(token, "snapshot_done", { from: today }),
  ]);
  const book = new NaverKeyBook(secrets, token);
  const done = new Set(doneList);

  // 피이관 실적: 광고주별 날짜 → 금액
  const tf = new Map<string, { date: string; cost: number }[]>();
  for (const r of transferred) {
    const k = String(r.customer_id).trim();
    if (!tf.has(k)) tf.set(k, []);
    tf.get(k)!.push({ date: r.stat_date, cost: Number(r.paid_cost) || 0 });
  }
  const transferredSum = (cid: string, from: string, to: string) => {
    const rows = (tf.get(cid) ?? []).filter((x) => x.date >= from && x.date <= to);
    return { found: rows.length > 0, totalCost: Math.round(rows.reduce((t, x) => t + x.cost, 0)), days: rows.length };
  };

  // 기간 광고비 (예전 /api/adcost 와 같은 규칙)
  async function adcost(adv: Advertiser, from: string, to: string): Promise<Cost> {
    const cid = String(adv.customer_id).trim();
    const src = adv.adcost_source ?? "auto";
    if (src === "transferred") {
      if (!adv.transferred_at) return { ok: false, message: "피이관 광고주인데 피이관 시작일이 없습니다." };
      const t = transferredSum(cid, from, to);
      return { ok: true, totalCost: t.totalCost, days: t.days, source: "transferred" };
    }
    const r = await naverCall(book, adv, "/billing/bizmoney/histories/period", new URLSearchParams({ searchStartDt: from, searchEndDt: to }));
    if (r.ok && Array.isArray(r.data)) {
      const rows = r.data as Record<string, unknown>[];
      const total = rows.reduce((t, x) => t + Number(x.useRefundableAmt || 0) + Number(x.useNonRefundableAmt || 0), 0);
      return { ok: true, totalCost: Math.round(total), days: rows.length, source: "naver_api" };
    }
    if (src === "naver_api") return { ok: false, message: naverMessage(r.data) ?? `네이버 오류 (${r.status})` };
    const t = transferredSum(cid, from, to);
    if (t.found) return { ok: true, totalCost: t.totalCost, days: t.days, source: "transferred" };
    return { ok: false, message: naverMessage(r.data) ?? `네이버 오류 (${r.status})` };
  }

  async function current(adv: Advertiser) {
    const mapped = adv.mapped_at ? String(adv.mapped_at).slice(0, 10) : null;
    const start = mapped && mapped > monthStart ? mapped : monthStart;
    const effDays = start <= today ? daysInclusive(start, today) : 0;
    const base = {
      advertiser_id: adv.id, customer_id: String(adv.customer_id).trim(), advertiser_name: adv.name, manager: adv.manager?.trim() || null,
      period_start: start, period_end: today, bizmoney: null as number | null, gross_total_cost: null as number | null, gross_daily_average: null as number | null,
      calculation_days: null as number | null, expected_days: null as number | null, key_source: null as string | null, error: null as string | null,
      source: "error", status: "failed", reason: "",
    };
    try {
      if (effDays <= 0) return { ...base, gross_total_cost: 0, gross_daily_average: 0, calculation_days: 0, source: "mapped_after_range", status: "normal", reason: "조회기간 이후 매핑" };
      const c = await adcost(adv, start, today);
      if (!c.ok) return { ...base, reason: "광고비 조회 실패", error: c.message };
      const days = c.source === "transferred" ? c.days : effDays;
      const avg = days > 0 ? Math.round(c.totalCost / days) : 0;
      const cost = { gross_total_cost: c.totalCost, gross_daily_average: avg, calculation_days: days };
      if (c.source === "transferred") return { ...base, ...cost, source: "transferred", status: "transferred", reason: "피이관 · 실적파일 기준" };
      const b = await naverCall(book, adv, "/billing/bizmoney");
      if (!b.ok) return { ...base, ...cost, reason: "비즈머니 조회 실패", error: naverMessage(b.data) };
      const bizmoney = Math.round(Number((b.data as { bizmoney?: number })?.bizmoney ?? 0));
      const expected = avg > 0 ? bizmoney / avg : null;
      const s = determineStatus(bizmoney, expected);
      return { ...base, ...cost, source: "naver_api", key_source: b.keySource, bizmoney, expected_days: expected === null ? null : Math.round(expected * 100) / 100, ...s };
    } catch (e) {
      return { ...base, reason: "서버 연결 오류", error: e instanceof Error ? e.message : String(e) };
    }
  }

  // 전월 같은 기간 (VAT 제외)
  async function previous(adv: Advertiser) {
    const pe = prevMonthSameDay(today);
    const f = { prev_period_start: prevStart, prev_period_end: pe };
    const mapped = adv.mapped_at ? String(adv.mapped_at).slice(0, 10) : null;
    const start = mapped && mapped > prevStart ? mapped : prevStart;
    if (start > pe) return { ...f, prev_active: false, prev_total_cost: 0, prev_daily_average: 0 };
    const days = daysInclusive(start, pe);
    try {
      const c = await adcost(adv, start, pe);
      if (!c.ok) return { ...f, prev_active: true, prev_total_cost: 0, prev_daily_average: 0 };
      const cost = c.source === "transferred" ? c.totalCost : Math.round(c.totalCost / 1.1);
      const cd = c.source === "transferred" ? c.days : days;
      return { ...f, prev_active: true, prev_total_cost: cost, prev_daily_average: cd > 0 ? Math.round(cost / cd) : 0 };
    } catch {
      return { ...f, prev_active: true, prev_total_cost: 0, prev_daily_average: 0 };
    }
  }

  const all = advertisers.filter((a) => String(a.customer_id ?? "").trim() && (!opts.customerId || String(a.customer_id).trim() === opts.customerId));
  const targets = all.filter((a) => !done.has(String(a.customer_id).trim()));
  const rows: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  await pool(targets, CONCURRENCY, async (adv) => {
    if (Date.now() - started > TIME_BUDGET_MS) { skipped.push(String(adv.customer_id)); return; }
    const [c, p] = await Promise.all([current(adv), previous(adv)]);
    rows.push({ ...c, ...p, snapshot_date: today, captured_at: new Date().toISOString() });
  });
  const saved = await saveRows(token, "ads_bizmoney_snapshots", rows);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const summary = {
    snapshotDate: today, advertiserCount: all.length, alreadyDoneCount: done.size, targetCount: targets.length, savedCount: saved,
    danger: count("danger"), warning: count("warning"), normal: count("normal"), transferred: count("transferred"), failed: count("failed"),
    skippedCount: skipped.length, skipped: skipped.slice(0, 50), elapsedMs: Date.now() - started,
  };
  if (skipped.length) throw Object.assign(new Error(`시간 제한으로 ${skipped.length}곳을 건너뛰었습니다 (다음 실행이 이어서 함)`), { summary });
  return summary;
}
