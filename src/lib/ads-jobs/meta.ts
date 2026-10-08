import "server-only";
import { adsRpc } from "@/lib/ads-db";
import { kstDate, loadSecrets, readData, saveRows } from "./common";

// 메타 광고비 일별 수집 (예전 api/meta-sync.js 와 같음)
//   대상: 사용 중인 메타 광고계정 / 기간: 최근 3일(그제~오늘) 다시 받기 — 메타가 나중에 고치는 금액 반영
//   토큰: 광고주별 메타 토큰(계정 ID 기준) → 없으면 공용 시스템 사용자 토큰
//   메타가 돌려준 날짜만 저장 (실패·빈 날을 0원으로 만들지 않음)

type Account = { id: number; external_account_id: string; account_name: string; currency: string | null; timezone_name: string | null };
const actId = (v: unknown) => {
  const d = String(v ?? "").trim().replace(/^act_/i, "");
  return /^\d+$/.test(d) ? `act_${d}` : null;
};

class MetaError extends Error {
  constructor(message: string, public status: number, public code: number | null) { super(message); }
}

export async function runMetaSync(token: string, range: { from?: string; to?: string } = {}) {
  const from = range.from ?? kstDate(-2), to = range.to ?? kstDate(0);
  const [secrets, accounts] = await Promise.all([loadSecrets(token), readData<Account[]>(token, "meta_accounts")]);
  const version = secrets.env.META_GRAPH_API_VERSION?.trim() || "v26.0";
  const shared = secrets.env.META_SYSTEM_USER_ACCESS_TOKEN?.trim() || "";
  const perAccount = new Map<string, { advertiserId: number; token: string }>();
  for (const c of secrets.credentials) {
    const k = actId(c.account_id);
    if (c.platform === "meta" && k && c.secret && ["valid", "unverified"].includes(c.status)) perAccount.set(k, { advertiserId: Number(c.advertiser_id), token: c.secret });
  }

  async function get(path: string, params: Record<string, string>, tk: string) {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tk}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const data = (await res.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null;
    if (!res.ok) throw new MetaError(data?.error?.message || `Meta API 요청 실패 (${res.status})`, res.status, data?.error?.code ?? null);
    return data as Record<string, unknown>;
  }

  let ok = 0, failed = 0, rowsUpserted = 0;
  const results: { account: string; name: string; ok: boolean; rows?: number; message?: string }[] = [];
  for (const a of accounts) {
    const ext = actId(a.external_account_id);
    if (!ext) { failed++; results.push({ account: a.external_account_id, name: a.account_name, ok: false, message: "Meta 광고계정 ID 형식 오류" }); continue; }
    const own = perAccount.get(ext);
    const tk = own?.token || shared;
    if (!tk) { failed++; results.push({ account: ext, name: a.account_name, ok: false, message: "Meta 토큰 없음" }); continue; }
    try {
      const info = await get(ext, { fields: "id,name,account_status,currency,timezone_name" }, tk);
      const ins = await get(`${ext}/insights`, { fields: "account_id,account_name,spend", level: "account", time_range: JSON.stringify({ since: from, until: to }), time_increment: "1", limit: "500" }, tk);
      const now = new Date().toISOString();
      const currency = (info.currency as string) || a.currency || "KRW";
      const byDate = new Map<string, Record<string, unknown>>();
      for (const r of (Array.isArray(ins.data) ? ins.data : []) as Record<string, unknown>[]) {
        const d = String(r.date_start ?? "").trim();
        const spend = Number(r.spend);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(spend) || spend < 0) continue;
        byDate.set(d, { meta_account_id: a.id, stat_date: d, spend, currency, collected_at: now });
      }
      rowsUpserted += await saveRows(token, "ads_meta_spend_daily", [...byDate.values()]);
      await saveRows(token, "ads_meta_accounts", [{
        id: a.id, external_account_id: a.external_account_id, account_name: (info.name as string) || a.account_name,
        currency: (info.currency as string) || a.currency, timezone_name: (info.timezone_name as string) || a.timezone_name, last_synced_at: now,
      }]);
      ok++;
      results.push({ account: ext, name: (info.name as string) || a.account_name, ok: true, rows: byDate.size });
    } catch (e) {
      failed++;
      const err = e instanceof MetaError ? e : null;
      if (own && err && (err.status === 401 || err.status === 403 || err.code === 190)) {
        await adsRpc("ads_mark_credential", { p_token: token, p_advertiser_id: own.advertiserId, p_platform: "meta", p_status: "invalid", p_message: err.message }).catch(() => {});
      }
      results.push({ account: ext, name: a.account_name, ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  }
  const summary = { from, to, graphVersion: version, requestedAccounts: accounts.length, successfulAccounts: ok, failedAccounts: failed, rowsUpserted, results };
  if (failed && !ok) throw Object.assign(new Error(`메타 계정 ${failed}개 모두 실패: ${results[0]?.message ?? ""}`), { summary });
  return summary;
}
