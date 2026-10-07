import "server-only";

// 기존 대시보드(naver-bizmoney-dashboard)에서 담당자별 월 소진액을 읽어 옴 (읽기 전용 통로 hub_month_spend)
//   네이버: 이관 광고비(VAT 제외) 합계, 광고주의 현재 담당자 기준
//   메타: 담당 배정 기간 기준 소진액(VAT 포함)
export type DashboardSpend = { employee_name: string; naver_spend: number; meta_spend: number };

export async function fetchDashboardSpend(month: string): Promise<{ rows: DashboardSpend[]; error?: string }> {
  const url = process.env.DASHBOARD_SUPABASE_URL;
  const key = process.env.DASHBOARD_SUPABASE_KEY;
  const token = process.env.DASHBOARD_HUB_TOKEN;
  if (!url || !key || !token) return { rows: [], error: "대시보드 연결 설정이 없습니다 (Vercel 환경변수)." };
  try {
    const res = await fetch(`${url}/rest/v1/rpc/hub_month_spend`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_month: month, p_token: token }),
      cache: "no-store",
    });
    if (!res.ok) return { rows: [], error: `대시보드에서 읽지 못했습니다 (${res.status}).` };
    const data = (await res.json()) as DashboardSpend[];
    return { rows: data.map((d) => ({ employee_name: d.employee_name, naver_spend: Number(d.naver_spend) || 0, meta_spend: Number(d.meta_spend) || 0 })) };
  } catch {
    return { rows: [], error: "대시보드에 연결하지 못했습니다." };
  }
}
