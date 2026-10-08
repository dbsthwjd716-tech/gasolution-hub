import "server-only";
import { adsRpc } from "@/lib/ads-db";

// [이전 기간] 예전 대시보드 서버 → 통합 DB 금고: 수집용 키와 광고주별 API
//   값은 이 함수 안에서만 지나가고, 결과에는 개수만 남김
export async function runImportSecrets(token: string) {
  const hubToken = process.env.DASHBOARD_HUB_TOKEN;
  const base = process.env.DASHBOARD_APP_URL || "https://naver-bizmoney-dashboard.vercel.app";
  if (!hubToken) throw new Error("예전 대시보드 연결 설정이 없습니다");
  const res = await fetch(`${base}/api/hub?route=hub-secrets`, { method: "POST", headers: { "x-hub-token": hubToken }, cache: "no-store" });
  if (!res.ok) throw new Error(`예전 대시보드에서 받지 못했습니다 (${res.status})`);
  const body = (await res.json()) as { env: Record<string, string>; credentials: Record<string, unknown>[]; failed: number[] };
  const env = await adsRpc<number>("ads_store_env", { p_token: token, p_env: body.env ?? {} });
  let creds = 0;
  const skipped: number[] = [];
  for (const c of body.credentials ?? []) {
    try {
      await adsRpc("ads_store_credential", { p_token: token, p: c });
      creds++;
    } catch {
      skipped.push(Number(c.advertiser_id));
    }
  }
  return { env_values: env, credentials: creds, skipped, unreadable_in_old: body.failed ?? [] };
}
