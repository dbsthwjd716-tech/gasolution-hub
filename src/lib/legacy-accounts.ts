import "server-only";

// 예전 네이버 대시보드의 광고주(매체 계정) 목록·등록·수정, 피이관 유상실적 업로드
//   아침 비즈머니·검색광고 수집이 아직 예전 대시보드에서 돌기 때문에, 같은 표에 저장해야 수집이 이어짐 (허브 서버 토큰으로만)
async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const url = process.env.DASHBOARD_SUPABASE_URL;
  const key = process.env.DASHBOARD_SUPABASE_KEY;
  const token = process.env.DASHBOARD_HUB_TOKEN;
  if (!url || !key || !token) return { error: "예전 대시보드 연결 설정이 없습니다 (Vercel 환경변수)." };
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, p_token: token }),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { error: (json as { message?: string } | null)?.message ?? `예전 대시보드 오류 (${res.status})` };
    return { data: json as T };
  } catch {
    return { error: "예전 대시보드에 연결하지 못했습니다." };
  }
}

export type LegacyAdvertiser = {
  id: number; name: string; customer_id: string | null; gfa_ad_account_no: number | null; manager: string | null;
  mapped_at: string | null; adcost_source: "auto" | "naver_api" | "transferred"; transferred_at: string | null; created_at: string;
  group_id: number | null; group_name: string | null; meta_account: string | null;
};
export type AccountsExport = {
  advertisers: LegacyAdvertiser[];
  groups: { id: number; name: string }[];
  employees: { id: number; name: string; has_credential: boolean }[];
  transferred: { through: string | null; last_import: string | null; rows: number };
};

export const fetchAccounts = () => rpc<AccountsExport>("hub_accounts_export", {});
export const createAccount = (p: Record<string, unknown>) => rpc<number>("hub_account_create", { p });
export const updateAccount = (id: number, p: Record<string, unknown>) => rpc<null>("hub_account_update", { p_id: id, p });
export const importTransferred = (rows: unknown[], start: string, end: string) => rpc<number>("hub_transferred_import", { p_rows: rows, p_start: start, p_end: end });
