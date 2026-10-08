"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/supabase/server";
import { createAccount, importTransferred, updateAccount } from "@/lib/legacy-accounts";
import { parseTransferredCsv } from "@/lib/transferred-csv";

export type AccForm = { error: string; ok?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const won = (n: number) => n.toLocaleString("ko-KR");

async function manager() {
  const { me } = await getMe();
  return !!me && me.role !== "staff";
}
const touch = () => {
  revalidatePath("/ads/accounts");
  revalidatePath("/ads");
  revalidatePath("/ads/spend");
};

// 광고주(매체 계정) 등록: 네이버 검색광고 / GFA 전용 / 메타
export async function addAccount(_p: AccForm, f: FormData): Promise<AccForm> {
  if (!(await manager())) return { error: "광고주 등록은 대표·팀장만 할 수 있습니다." };
  const group = s(f, "group_id");
  const p = {
    type: s(f, "type"),
    name: s(f, "name"),
    customer_id: s(f, "customer_id"),
    gfa_no: s(f, "gfa_no"),
    meta_id: s(f, "meta_id"),
    manager: s(f, "manager"),
    group_id: group === "new" ? "" : group,
    new_group: group === "new" ? s(f, "new_group") : "",
    mapped_at: s(f, "mapped_at"),
    adcost_source: s(f, "adcost_source") || "auto",
    transferred_at: s(f, "transferred_at"),
    meta_from: s(f, "meta_from"),
  };
  const { data: id, error } = await createAccount(p);
  if (error) return { error };
  touch();
  const done = `「${p.name}」 등록했습니다. 내일 아침 비즈머니 확인부터 반영됩니다.`;
  // 네이버 검색광고: API 라이선스·비밀키를 함께 넣었으면 바로 확인 후 저장
  const apiKey = s(f, "api_key");
  const secretKey = s(f, "secret_key");
  if (p.type === "SA" && id && (apiKey || secretKey)) {
    const { me } = await getMe();
    const { saveCredential } = await import("@/lib/legacy-credentials");
    const r = await saveCredential({ action: "save", advertiserId: Number(id), platform: "naver_searchad", accountId: p.customer_id, apiKey, secretKey, actor: me?.name });
    if (r.error) return { error: `${done} 다만 API 확인에 실패해 API는 저장하지 않았습니다: ${r.error} (목록에서 다시 등록할 수 있습니다)` };
    return { error: "", ok: `${done} API도 연동했습니다 (${r.data?.message ?? "확인 완료"}).` };
  }
  return { error: "", ok: done };
}

// 실적 기준·피이관 시작일·그룹 바꾸기
export async function editAccount(id: number, _p: AccForm, f: FormData): Promise<AccForm> {
  if (!(await manager())) return { error: "대표·팀장만 바꿀 수 있습니다." };
  const { error } = await updateAccount(id, { adcost_source: s(f, "adcost_source"), transferred_at: s(f, "transferred_at"), group_id: s(f, "group_id") });
  if (error) return { error };
  touch();
  return { error: "", ok: "저장했습니다." };
}

// 피이관 유상실적 CSV 업로드 (네이버에서 받은 파일 그대로, 한글 EUC-KR·UTF-8 모두)
export async function uploadTransferred(_p: AccForm, f: FormData): Promise<AccForm> {
  if (!(await manager())) return { error: "업로드는 대표·팀장만 할 수 있습니다." };
  const file = f.get("file");
  if (!(file instanceof File) || !file.size) return { error: "CSV 파일을 골라 주세요." };
  if (file.size > 4 * 1024 * 1024) return { error: "파일이 4MB보다 큽니다. 기간을 나눠서 받아 올려 주세요 (예: 한 달씩)." };
  const buf = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("euc-kr").decode(buf);
  }
  const parsed = parseTransferredCsv(text);
  if ("error" in parsed) return { error: parsed.error };
  let saved = 0;
  for (let i = 0; i < parsed.rows.length; i += 5000) {
    const { data, error } = await importTransferred(parsed.rows.slice(i, i + 5000), parsed.start!, parsed.end!);
    if (error) return { error: `${saved ? `${saved}줄 저장 후 ` : ""}멈췄습니다: ${error}` };
    saved += Number(data ?? 0);
  }
  touch();
  return {
    error: "",
    ok: `${parsed.start} ~ ${parsed.end} · 계정 ${parsed.customers}곳 · ${saved}줄 저장 · 유상실적 합계 ${won(parsed.total)}원${parsed.skipped ? ` (날짜·계정 번호가 없는 ${parsed.skipped}줄은 건너뜀)` : ""}`,
  };
}

// 광고주 API 등록·다시 확인·해제 (네이버 검색광고 라이선스·비밀키 / Meta 토큰)
//   실제로 네이버·Meta에 접속해 확인된 경우에만 저장됨
export async function saveApi(advertiserId: number, platform: "naver_searchad" | "meta", _p: AccForm, f: FormData): Promise<AccForm> {
  const { me } = await getMe();
  if (!me || me.role === "staff") return { error: "API 등록은 대표·팀장만 할 수 있습니다." };
  const action = s(f, "action") || "save";
  const { saveCredential } = await import("@/lib/legacy-credentials");
  const { data, error } = await saveCredential({
    action,
    advertiserId,
    platform,
    accountId: s(f, "account_id"),
    apiKey: s(f, "api_key"),
    secretKey: s(f, "secret_key"),
    accessToken: s(f, "access_token"),
    actor: me.name,
  });
  if (error) return { error };
  revalidatePath("/ads/accounts");
  return { error: "", ok: [data?.message, data?.warning].filter(Boolean).join(" · ") || "저장했습니다." };
}

// API 값 보기: 대표·팀장만, 열람 기록을 먼저 남겨야 값을 받아 옴 (기록이 안 되면 보여 주지 않음)
export async function revealApi(advertiserId: number, advertiserName: string, platform: "naver_searchad" | "meta"): Promise<{ error?: string; accountId?: string; apiKey?: string; secret?: string }> {
  const { supabase, me } = await getMe();
  if (!me || (me.role !== "ceo" && me.role !== "lead")) return { error: "API 값은 대표·팀장만 볼 수 있습니다." };
  const { error: logError } = await supabase.from("api_reveal_log").insert({ advertiser_id: advertiserId, advertiser_name: advertiserName, platform });
  if (logError) return { error: `열람 기록을 남기지 못해 보여 드릴 수 없습니다: ${logError.message}` };
  const { revealCredential } = await import("@/lib/legacy-credentials");
  const { data, error } = await revealCredential(advertiserId, platform);
  if (error || !data) return { error: error ?? "값을 가져오지 못했습니다." };
  return { accountId: data.accountId, apiKey: data.apiKey, secret: data.secret };
}
