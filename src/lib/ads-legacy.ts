import "server-only";
import type { BizRow, PrevRow, Run } from "./ads";

// 예전 네이버 대시보드의 광고 운영 데이터를 읽어 옴 (읽기 전용 통로 hub_ads_export, 매일 아침 수집은 예전 대시보드가 계속 함)
async function call<T>(kind: string, start: string | null, end: string | null): Promise<{ data?: T; error?: string }> {
  const url = process.env.DASHBOARD_SUPABASE_URL;
  const key = process.env.DASHBOARD_SUPABASE_KEY;
  const token = process.env.DASHBOARD_HUB_TOKEN;
  if (!url || !key || !token) return { error: "예전 대시보드 연결 설정이 없습니다 (Vercel 환경변수)." };
  try {
    const [fn, body] =
      kind === "promo" ? ["hub_promo_spend", { p_start: start, p_end: end, p_token: token }]
      : kind === "naver_split" ? ["hub_naver_split", { p_token: token }]
      : kind === "roas" ? ["hub_roas_watch", { p_token: token }]
      : kind === "perf" ? ["hub_perf_spend", { p_start: start, p_end: end, p_token: token }]
      : ["hub_ads_export", { p_kind: kind, p_start: start, p_end: end, p_token: token }];
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      next: { revalidate: 300 }, // 아침에 한 번 바뀌는 데이터라 5분 동안은 다시 묻지 않음
    });
    if (!res.ok) return { error: `예전 대시보드에서 읽지 못했습니다 (${res.status}).` };
    return { data: (await res.json()) as T };
  } catch {
    return { error: "예전 대시보드에 연결하지 못했습니다." };
  }
}

export type BizmoneyExport = { snapshot_date: string | null; previous_date: string | null; rows: BizRow[]; previous: PrevRow[] };
export const fetchBizmoney = () => call<BizmoneyExport>("bizmoney", null, null);

export type OpsStatusExport = {
  today: string;
  runs: Run[];
  searchad_latest: string | null;
  searchad_targets: number;
  searchad_done: number;
  meta_accounts: { account_name: string; last_synced_at: string | null }[];
};
export const fetchOpsStatus = () => call<OpsStatusExport>("ops_status", null, null);

export type GroupSpendRow = { employee_name: string; client_group_name: string; searchad_spend: number; gfa_spend: number; meta_spend: number };
export const fetchGroupSpend = (start: string, end: string) => call<{ rows: GroupSpendRow[] }>("group_spend", start, end);

export type MetaSpendRow = { stat_date: string; employee_name: string; external_account_id: string; account_name: string; advertiser_name: string | null; spend: number };
export const fetchMetaSpend = (start: string, end: string) => call<{ rows: MetaSpendRow[] }>("meta_spend", start, end);

// 주간 일소진 프로모션: 날짜·담당자별 네이버 유상실적(VAT 별도)과 메타 광고비
export type { PromoSpend } from "./promo";
export const fetchPromoSpend = (start: string, end: string) => call<import("./promo").PromoSpend>("promo", start, end);

// 광고주별 이번 달 비즈머니 소진 (검색광고 + GFA 합산). 검색광고 기록이 없는 광고주 = GFA 전용(성과형) 계정
export type NaverSplitRow = {
  customer_id: string; advertiser_name: string | null; manager: string | null; client_group: string | null; gfa_ad_account_no: number | null;
  period_start: string; period_end: string; month_cost: number; searchad_cost: number; gfa_only: boolean;
};
export type NaverSplit = { snapshot_date: string | null; searchad_from: string | null; searchad_through: string | null; gfa_collected_through: string | null; rows: NaverSplitRow[] };
export const fetchNaverSplit = () => call<NaverSplit>("naver_split", null, null);

// 광고비 실적: 기간 내 네이버 유상실적(검색광고+GFA, VAT 별도) 광고주별 + 메타 계정별(VAT 포함)
//   handover_cost: 서진원 인계건 (지금 담당이 따로 있고, 그룹이 '진원 인계건'인 소진)
export type PerfNaver = { manager: string; customer_id: string; advertiser_name: string | null; group: string | null; cost: number; handover_cost: number | null };
export type PerfMeta = { manager: string; account_name: string; advertiser_name: string | null; spend: number; days: number };
export type PerfSpend = { naver_through: string | null; meta_through: string | null; naver: PerfNaver[]; meta: PerfMeta[] };
export const fetchPerfSpend = (start: string, end: string) => call<PerfSpend>("perf", start, end);

// 오늘의 운영: 광고주별 어제 검색광고 수익률과 그 전 7일
export const fetchRoasWatch = () => call<{ date: string | null; rows: import("./ads").RoasRow[] }>("roas", null, null);
