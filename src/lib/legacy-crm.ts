import "server-only";
import { fetchRetry } from "./fetch-retry";

// 예전 인입 CRM(gasolution-lead-crm)에서 문의·상담 기록·상태 이력을 읽어 옴 (읽기 전용 통로 hub_export_leads)
export type LegacyExport = { leads: { id: string; inquiry_at: string; company_name: string; owner: string | null }[]; logs: unknown[]; history: unknown[] };

export async function fetchLegacyLeads(): Promise<{ data?: LegacyExport; error?: string }> {
  const url = process.env.CRM_SUPABASE_URL;
  const key = process.env.CRM_SUPABASE_KEY;
  const token = process.env.CRM_HUB_TOKEN;
  if (!url || !key || !token) return { error: "예전 CRM 연결 설정이 없습니다 (Vercel 환경변수)." };
  try {
    const res = await fetchRetry(`${url}/rest/v1/rpc/hub_export_leads`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }),
      cache: "no-store",
    });
    if (!res.ok) return { error: `예전 CRM에서 읽지 못했습니다 (${res.status}).` };
    return { data: (await res.json()) as LegacyExport };
  } catch {
    return { error: "예전 CRM에 연결하지 못했습니다." };
  }
}
