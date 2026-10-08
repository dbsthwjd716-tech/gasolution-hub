import "server-only";
import { fetchRetry } from "./fetch-retry";

// 예전 대시보드에서 근태·연차 기록을 읽어 옴 (읽기 전용 통로 hub_export_attendance, 급여 실적과 같은 연결 설정 사용)
export type LegacyAttendance = {
  employees: { id: number; name: string; employment_status: string }[];
  leaves: unknown[];
  records: unknown[];
  exceptions: unknown[];
  balances: unknown[];
  holidays: unknown[];
  corrections: unknown[];
  [k: string]: unknown;
};

export async function fetchLegacyAttendance(): Promise<{ data?: LegacyAttendance; error?: string }> {
  const url = process.env.DASHBOARD_SUPABASE_URL;
  const key = process.env.DASHBOARD_SUPABASE_KEY;
  const token = process.env.DASHBOARD_HUB_TOKEN;
  if (!url || !key || !token) return { error: "예전 대시보드 연결 설정이 없습니다 (Vercel 환경변수)." };
  try {
    const res = await fetchRetry(`${url}/rest/v1/rpc/hub_export_attendance`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }),
      cache: "no-store",
    });
    if (!res.ok) return { error: `예전 대시보드에서 읽지 못했습니다 (${res.status}).` };
    return { data: (await res.json()) as LegacyAttendance };
  } catch {
    return { error: "예전 대시보드에 연결하지 못했습니다." };
  }
}
