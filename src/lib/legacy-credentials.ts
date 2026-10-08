import "server-only";

// 광고주 API 연동 (네이버 검색광고 라이선스·비밀키 / Meta 토큰)
//   비밀값은 예전 대시보드 서버가 실제로 접속 확인 후 암호화해 저장 (암호화 키는 그쪽에만 있음, 허브는 보관하지 않음)
//   화면에는 끝 4자리와 상태만
const BASE = process.env.DASHBOARD_APP_URL || "https://naver-bizmoney-dashboard.vercel.app";

export type CredInfo = { accountId: string; keyHint: string; status: "valid" | "unverified" | "invalid"; statusMessage: string; lastVerifiedAt: string | null; updatedBy: string | null } | null;
export type CredRow = { id: number; name: string; manager: string; customerId: string; metaAccounts: { accountId: string; accountName: string | null }[]; naver: CredInfo; meta: CredInfo };

async function call<T>(method: "GET" | "POST", body?: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const token = process.env.DASHBOARD_HUB_TOKEN;
  if (!token) return { error: "예전 대시보드 연결 설정이 없습니다 (Vercel 환경변수)." };
  try {
    const res = await fetch(`${BASE}/api/hub?route=hub-credentials`, {
      method,
      headers: { "x-hub-token": token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as (T & { ok?: boolean; message?: string }) | null;
    if (!res.ok || !json || json.ok === false) return { error: json?.message ?? `예전 대시보드 응답 오류 (${res.status})` };
    return { data: json };
  } catch {
    return { error: "예전 대시보드에 연결하지 못했습니다." };
  }
}

export const fetchCredentials = () => call<{ advertisers: CredRow[] }>("GET");
export const saveCredential = (b: Record<string, unknown>) => call<{ message: string; warning?: string | null }>("POST", b);

export type Revealed = { accountId: string; apiKey: string; secret: string };
export const revealCredential = (advertiserId: number, platform: string) => call<Revealed>("POST", { action: "reveal", advertiserId, platform });
