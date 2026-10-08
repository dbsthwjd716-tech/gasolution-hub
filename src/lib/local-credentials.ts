import "server-only";
import { createHmac } from "node:crypto";
import { createClient } from "./supabase/server";
import type { CredRow, Revealed } from "./legacy-credentials";

// 광고주 API (통합 DB · 금고) — 저장 전에 네이버·Meta에 실제로 접속해 확인한 경우에만 저장 (예전 대시보드와 같은 규칙)

type Res<T> = { data?: T; error?: string };
const actId = (v: unknown) => {
  const d = String(v ?? "").trim().replace(/^act_/i, "");
  return /^\d+$/.test(d) ? `act_${d}` : null;
};

async function verifyNaver(apiKey: string, secretKey: string, customerId: string) {
  const ts = Date.now().toString(), uri = "/billing/bizmoney";
  const sig = createHmac("sha256", secretKey).update(`${ts}.GET.${uri}`).digest("base64");
  try {
    const res = await fetch(`https://api.searchad.naver.com${uri}`, {
      headers: { "X-Timestamp": ts, "X-API-KEY": apiKey, "X-Customer": customerId, "X-Signature": sig, "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const d = (await res.json().catch(() => null)) as { bizmoney?: number; title?: string; detail?: string; message?: string } | null;
    if (res.ok && d && d.bizmoney !== undefined) return { ok: true, message: `연동 확인 · 비즈머니 ${Math.round(Number(d.bizmoney || 0)).toLocaleString("ko-KR")}원` };
    if (res.status === 401 || res.status === 403) return { ok: false, message: "네이버가 키를 거부했습니다. 라이선스·비밀키·고객 ID가 같은 계정의 값인지 확인해 주세요." };
    return { ok: false, message: d?.title || d?.detail || d?.message || `네이버 응답 오류 (${res.status})` };
  } catch (e) {
    return { ok: false, message: `네이버 접속 실패: ${e instanceof Error ? e.message : e}` };
  }
}

async function verifyMeta(accountId: string, token: string) {
  const url = new URL(`https://graph.facebook.com/v26.0/${accountId}`);
  url.searchParams.set("fields", "id,name,account_status,currency");
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const d = (await res.json().catch(() => null)) as { id?: string; name?: string; account_status?: number; error?: { message?: string; code?: number } } | null;
    if (res.ok && d?.id) return { ok: true, message: `연동 확인 · ${d.name || accountId} (${Number(d.account_status) === 1 ? "활성" : `상태 코드 ${d.account_status}`})` };
    const m = d?.error?.message || `Meta 응답 오류 (${res.status})`;
    if (d?.error?.code === 190) return { ok: false, message: "토큰이 만료되었거나 올바르지 않습니다. 새 토큰을 발급해 주세요." };
    if (d?.error?.code === 100 || res.status === 400) return { ok: false, message: `이 토큰으로 해당 광고계정을 볼 수 없습니다. 계정 ID와 권한을 확인해 주세요. (${m})` };
    return { ok: false, message: m };
  } catch (e) {
    return { ok: false, message: `Meta 접속 실패: ${e instanceof Error ? e.message : e}` };
  }
}

export async function localFetchCredentials(): Promise<Res<{ advertisers: CredRow[] }>> {
  const { data, error } = await (await createClient()).rpc("ads_local_credentials");
  return error ? { error: error.message } : { data: data as { advertisers: CredRow[] } };
}

export async function localRevealCredential(advertiserId: number, platform: string): Promise<Res<Revealed>> {
  const { data, error } = await (await createClient()).rpc("ads_local_credential_secret", { p_advertiser: advertiserId, p_platform: platform });
  if (error) return { error: error.message };
  if (!data) return { error: "등록된 API 정보가 없습니다." };
  const d = data as { accountId: string; apiKey: string | null; secret: string | null };
  return { data: { accountId: d.accountId ?? "", apiKey: d.apiKey ?? "", secret: d.secret ?? "" } };
}

export async function localSaveCredential(b: Record<string, unknown>): Promise<Res<{ message: string; warning?: string | null }>> {
  const supabase = await createClient();
  const action = String(b.action || "save");
  const platform = String(b.platform || "");
  const advertiserId = Number(b.advertiserId);
  if (!["naver_searchad", "meta"].includes(platform) || !advertiserId) return { error: "광고주와 매체를 확인해 주세요." };
  const { data: adv } = await supabase.from("ads_advertisers").select("id,customer_id").eq("id", advertiserId).maybeSingle();
  if (!adv) return { error: "광고주를 찾을 수 없습니다." };

  if (action === "delete") {
    const { data: had, error: be } = await supabase.rpc("ads_local_credential_blank", { p_advertiser: advertiserId, p_platform: platform });
    if (be) return { error: be.message };
    if (!had) return { data: { message: "등록된 API 정보가 없습니다." } };
    const { error } = await supabase.from("ads_api_credentials").delete().eq("advertiser_id", advertiserId).eq("platform", platform);
    return error ? { error: "연동 해제에 실패했습니다." } : { data: { message: "연동을 해제했습니다. 이후에는 공용 키를 사용합니다." } };
  }

  // 확인에 쓸 값 (수정할 때 빈 칸은 기존 값)
  const old = (await localRevealCredential(advertiserId, platform)).data;
  let accountId: string, apiKey = "", secret: string;
  if (platform === "naver_searchad") {
    accountId = String(b.accountId || old?.accountId || adv.customer_id || "").trim();
    apiKey = String(b.apiKey || "").trim() || (old?.apiKey && old.apiKey !== "-" ? old.apiKey : "");
    secret = String(b.secretKey || "").trim() || (old?.secret && old.secret !== "-" ? old.secret : "");
    if (!/^\d+$/.test(accountId)) return { error: "네이버 고객 ID(숫자)를 입력해 주세요." };
    if (adv.customer_id && String(adv.customer_id).trim() !== accountId) return { error: `이 광고주에 등록된 네이버 고객 ID(${adv.customer_id})와 다릅니다. 같은 계정의 API 정보를 입력해 주세요.` };
    if (!apiKey || !secret) return { error: "API 라이선스와 비밀키를 모두 입력해 주세요." };
  } else {
    accountId = actId(b.accountId || old?.accountId || "") ?? "";
    secret = String(b.accessToken || "").trim() || (old?.secret && old.secret !== "-" ? old.secret : "");
    if (!accountId) return { error: "Meta 광고계정 ID를 숫자(act_ 생략 가능)로 입력해 주세요." };
    if (!secret) return { error: "Meta 액세스 토큰을 입력해 주세요." };
  }
  const check = platform === "naver_searchad" ? await verifyNaver(apiKey, secret, accountId) : await verifyMeta(accountId, secret);
  if (!check.ok) {
    if (old && action === "verify") await supabase.rpc("ads_local_credential_mark", { p_advertiser: advertiserId, p_platform: platform, p_status: "invalid", p_message: check.message });
    return { error: check.message };
  }
  let warning: string | null = null;
  if (platform === "meta") {
    const { data: linked } = await supabase.from("ads_meta_accounts").select("external_account_id").eq("advertiser_id", advertiserId);
    if (!(linked ?? []).some((a) => actId(a.external_account_id) === accountId)) warning = "이 광고주의 Meta 계정 목록에 없는 ID입니다. 매일 수집 대상이 되려면 같은 Meta 계정을 광고주에 추가해 주세요.";
  }
  const { error } = await supabase.rpc("ads_local_credential_save", {
    p_advertiser: advertiserId, p_platform: platform, p_account_id: accountId, p_api_key: platform === "naver_searchad" ? apiKey : null,
    p_secret: secret, p_message: check.message, p_actor: String(b.actor ?? "통합 시스템").slice(0, 40),
  });
  if (error) return { error: `저장하지 못했습니다: ${error.message}` };
  return { data: { message: check.message, warning } };
}
