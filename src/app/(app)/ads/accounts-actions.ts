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
  const { error } = await createAccount(p);
  if (error) return { error };
  touch();
  return { error: "", ok: `「${p.name}」 등록했습니다. 내일 아침 비즈머니 확인부터 반영됩니다.` };
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
