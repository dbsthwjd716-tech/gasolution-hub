import "server-only";
import { kstDate, loadSecrets, NaverKeyBook, naverCall, naverMessage, pool, readData, saveRows, type Advertiser } from "./common";
import { campaignTypeLabel, extractStat, num } from "./rules";

// 네이버 검색광고 일별 실적 (예전 lib/searchad-daily.js + naver-performance searchad-sync 와 같음)
//   대상: 가장 최근 비즈머니 기록에서 이번 달 광고비가 있는 네이버 광고주 (피이관·조회 실패 제외)
//   날짜: 어제부터 최근 3일 중 '완료'가 아닌 날 → 어제 먼저
//   캠페인별 하루 통계를 저장하고, 광고주·날짜별 완료/일부/실패 상태를 남김
//   정해진 시간까지만 하고 남은 건 다음 실행이 이어서 함

const LOOKBACK_DAYS = 3;
const PARALLEL_ADVERTISERS = 2;
const STATS_CONCURRENCY = 6;
const DEADLINE_MS = 200_000; // 이 뒤로는 새 일을 시작하지 않음
const HARD_STOP_MS = 270_000; // 네이버 재시도는 여기까지만
const FIELDS = ["impCnt", "clkCnt", "salesAmt", "ccnt", "convAmt", "purchaseCcnt", "purchaseConvAmt"];


type Campaign = { id: string; name: string; type: string | null; label: string; status: string | null; userLock: boolean | null };

export async function runSearchAdDaily(token: string) {
  const started = Date.now();
  const dates = Array.from({ length: LOOKBACK_DAYS }, (_, i) => kstDate(-(i + 1)));
  const [secrets, advertisers, plan, doneList] = await Promise.all([
    loadSecrets(token),
    readData<Advertiser[]>(token, "advertisers"),
    readData<{ snapshot_date: string | null; rows: { customer_id: string; advertiser_name: string | null }[] }>(token, "snapshot_targets"),
    readData<string[]>(token, "searchad_done", { from: dates[dates.length - 1], to: dates[0] }),
  ]);
  if (!plan.rows.length) return { ok: false, skipped: true, snapshotDate: plan.snapshot_date, message: plan.snapshot_date ? "이번 달 광고비가 있는 광고주가 없습니다." : "비즈머니 기록이 없어 대상을 정할 수 없습니다." };
  const book = new NaverKeyBook(secrets, token);
  book.deadline = started + HARD_STOP_MS;
  const byCid = new Map(advertisers.map((a) => [String(a.customer_id ?? "").trim(), a]));
  const done = new Set(doneList);
  const targets = plan.rows.map((r) => byCid.get(String(r.customer_id).trim())).filter((a): a is Advertiser => !!a && a.adcost_source !== "transferred");

  // 광고주별로 남은 날짜를 묶어 처리 (어제가 빠진 곳부터)
  const work = targets
    .map((a) => ({ adv: a, dates: dates.filter((d) => !done.has(`${String(a.customer_id).trim()}|${d}`)) }))
    .filter((w) => w.dates.length)
    .sort((x, y) => x.dates[0] < y.dates[0] ? 1 : x.dates[0] > y.dates[0] ? -1 : 0);

  const out = { attempted: 0, complete: 0, partial: 0, failed: 0, savedRows: 0, failures: [] as { customerId: string; name: string | null; date: string; message: string }[] };
  let stopped = false;
  const late = () => (Date.now() - started > DEADLINE_MS ? (stopped = true) : false);

  await pool(work, PARALLEL_ADVERTISERS, async ({ adv, dates: ds }) => {
    const cid = String(adv.customer_id).trim();
    const list = await naverCall(book, adv, "/ncc/campaigns");
    if (!list.ok || !Array.isArray(list.data)) {
      const message = naverMessage(list.data) ?? `캠페인 목록 조회 실패 (${list.status})`;
      await saveStatus(token, adv, ds.map((d) => ({ date: d, status: "failed", ok: 0, fail: 0, campaigns: 0, error: message })));
      out.attempted += ds.length; out.failed += ds.length;
      for (const d of ds) out.failures.push({ customerId: cid, name: adv.name, date: d, message });
      return;
    }
    const campaigns: Campaign[] = (list.data as Record<string, unknown>[])
      .map((c) => ({ id: String(c.nccCampaignId ?? ""), name: String(c.name ?? "-").trim(), type: (c.campaignTp as string) ?? null, label: campaignTypeLabel(c.campaignTp), status: (c.status as string) ?? null, userLock: (c.userLock as boolean) ?? null }))
      .filter((c) => c.id);
    for (const d of ds) {
      if (late()) return;
      const results: { c: Campaign; ok: boolean; stat?: Record<string, unknown>; message?: string }[] = [];
      await pool(campaigns, STATS_CONCURRENCY, async (c) => {
        const q = new URLSearchParams({ id: c.id, fields: JSON.stringify(FIELDS), timeRange: JSON.stringify({ since: d, until: d }), timeIncrement: "allDays" });
        const r = await naverCall(book, adv, "/stats", q);
        results.push(r.ok && r.data !== null ? { c, ok: true, stat: extractStat(r.data) } : { c, ok: false, message: naverMessage(r.data) ?? "캠페인 일별 통계 조회 실패" });
      }, late);
      if (results.length < campaigns.length) return; // 시간이 다 돼 중간에 멈춤 → 이 날짜는 다음 실행이 처음부터 (받은 것만 저장하면 '일부'로 남음)
      const now = new Date().toISOString();
      const rows = results.filter((x) => x.ok).map(({ c, stat }) => ({
        customer_id: cid, campaign_id: c.id, stat_date: d, advertiser_id: adv.id, campaign_name: c.name, campaign_type: c.type, campaign_type_label: c.label,
        impressions: Math.round(num(stat!.impCnt)), clicks: Math.round(num(stat!.clkCnt)), cost: Math.round(num(stat!.salesAmt)),
        conversions: num(stat!.ccnt), conversion_value: Math.round(num(stat!.convAmt)),
        purchase_conversions: num(stat!.purchaseCcnt), purchase_conversion_value: Math.round(num(stat!.purchaseConvAmt)),
        campaign_status: c.status, user_lock: c.userLock, collected_at: now,
      }));
      const fails = results.filter((x) => !x.ok);
      let status = fails.length ? (rows.length ? "partial" : "failed") : "complete";
      let error = fails.length ? fails.slice(0, 5).map((x) => `${x.c.name}: ${x.message}`).join(" | ") : null;
      try {
        out.savedRows += await saveRows(token, "ads_searchad_daily", rows);
      } catch (e) {
        status = "failed";
        error = `일별 실적 저장 실패: ${e instanceof Error ? e.message : e}`;
      }
      await saveStatus(token, adv, [{ date: d, status, ok: status === "failed" ? 0 : rows.length, fail: status === "failed" ? campaigns.length : fails.length, campaigns: campaigns.length, error }]);
      out.attempted++;
      if (status === "complete") out.complete++;
      else if (status === "partial") out.partial++;
      else out.failed++;
      if (status !== "complete") out.failures.push({ customerId: cid, name: adv.name, date: d, message: String(error ?? "").slice(0, 160) });
    }
  }, late);

  const yesterday = dates[0];
  const yesterdayDone = targets.filter((a) => done.has(`${String(a.customer_id).trim()}|${yesterday}`)).length + out.complete;
  return {
    snapshotDate: plan.snapshot_date, targetDates: dates, activeAccountCount: targets.length, alreadyComplete: done.size,
    ...out, failures: out.failures.slice(0, 15), stoppedForTime: stopped,
    yesterday: { date: yesterday, approxDone: yesterdayDone, total: targets.length }, elapsedMs: Date.now() - started,
  };
}

async function saveStatus(token: string, adv: Advertiser, items: { date: string; status: string; ok: number; fail: number; campaigns: number; error: string | null }[]) {
  const now = new Date().toISOString();
  await saveRows(token, "ads_searchad_status", items.map((i) => ({
    customer_id: String(adv.customer_id).trim(), stat_date: i.date, advertiser_id: adv.id, status: i.status,
    discovered_campaign_count: i.campaigns, successful_campaign_count: i.ok, failed_campaign_count: i.fail, saved_row_count: i.ok,
    error_summary: i.error, last_attempted_at: now, completed_at: i.status === "complete" ? now : null,
  }))).catch(() => {});
}
