import "server-only";
import type { BizRow, PrevRow, Run } from "./ads";

// 예전 네이버 대시보드의 광고 운영 데이터를 읽어 옴 (읽기 전용 통로 hub_ads_export, 매일 아침 수집은 예전 대시보드가 계속 함)
async function call<T>(kind: string, start: string | null, end: string | null): Promise<{ data?: T; error?: string }> {
  const url = process.env.DASHBOARD_SUPABASE_URL;
  const key = process.env.DASHBOARD_SUPABASE_KEY;
  const token = process.env.DASHBOARD_HUB_TOKEN;
  if (!url || !key || !token) return { error: "예전 대시보드 연결 설정이 없습니다 (Vercel 환경변수)." };
  try {
    const res = await fetch(`${url}/rest/v1/rpc/hub_ads_export`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_kind: kind, p_start: start, p_end: end, p_token: token }),
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
