"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkBizNo } from "@/lib/bizno";
import { createClient } from "@/lib/supabase/server";
import { parseUploaded } from "@/lib/uploads";

export type FormState = { error: string; ok?: string };

const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v.length ? v : null;
};

function emails(raw: string | null) {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

function kinds(f: FormData) {
  const k = f.getAll("kinds").map(String).filter((x) => x === "ad" || x === "viral");
  return k.length ? k : ["ad"];
}

function friendly(message: string, code?: string) {
  if (code === "23505") {
    if (message.includes("business_number")) return "이미 등록된 사업자번호입니다. 거래처 목록에서 검색해 보세요.";
    if (message.includes("media_accounts")) return "이미 다른 곳에 연결된 계정 번호입니다.";
    if (message.includes("name_aliases")) return "이미 다른 거래처에 등록된 이름입니다.";
    return "같은 정보가 이미 있습니다.";
  }
  if (message.includes("row-level security")) return "이 거래처를 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요.";
  return "저장하지 못했습니다: " + message;
}

function clientFields(f: FormData) {
  const bn = checkBizNo(s(f, "business_number"));
  if (!bn.ok) return { error: bn.message } as const;
  const company_name = s(f, "company_name");
  if (!company_name) return { error: "상호를 입력해 주세요." } as const;
  const feeType = s(f, "fee_markup_type") ?? "none";
  if (!["rate", "fixed", "none"].includes(feeType)) return { error: "수수료 방식이 올바르지 않습니다." } as const;
  const num = (k: string) => Number(String(f.get(k) ?? "").replace(/[^\d.]/g, "") || 0);
  const rate = num("fee_markup_rate");
  if (feeType === "rate" && !(rate > 0 && rate < 100)) return { error: "수수료율(%)을 0보다 크고 100보다 작게 입력해 주세요." } as const;
  const fixed = Math.round(num("fee_markup_fixed"));
  if (feeType === "fixed" && fixed <= 0) return { error: "고정 수수료 금액을 입력해 주세요." } as const;
  return {
    row: {
      fee_markup_type: feeType,
      fee_markup_rate: feeType === "rate" ? rate : 0,
      fee_markup_fixed: feeType === "fixed" ? fixed : 0,
      fee_min_fee: feeType === "rate" ? Math.round(num("fee_min_fee")) : 0,
      fee_vat_mode: s(f, "fee_vat_mode") === "excluded" ? "excluded" : "included",
      fee_note: s(f, "fee_note"),
      company_name,
      business_number: bn.value,
      representative_name: s(f, "representative_name"),
      address: s(f, "address"),
      business_type: s(f, "business_type"),
      business_item: s(f, "business_item"),
      billing_emails: emails(s(f, "billing_emails")),
      status: s(f, "status") ?? "active",
      kinds: kinds(f),
      memo: s(f, "memo"),
    },
  } as const;
}

export async function createClientRecord(_p: FormState, f: FormData): Promise<FormState> {
  const parsed = clientFields(f);
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").insert(parsed.row).select("id").single();
  if (error) return { error: friendly(error.message, error.code) };

  const brand = s(f, "brand_name");
  if (brand) await supabase.from("brands").insert({ client_id: data.id, name: brand });

  revalidatePath("/clients");
  redirect(`/clients/${data.id}`);
}

export async function updateClientRecord(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const parsed = clientFields(f);
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").update(parsed.row).eq("id", id).select("id");
  if (error) return { error: friendly(error.message, error.code) };
  if (!data?.length) return { error: "이 거래처를 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요." };
  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  return { error: "", ok: "저장했습니다." };
}

export async function addBrand(clientId: string, _p: FormState, f: FormData): Promise<FormState> {
  const name = s(f, "name");
  if (!name) return { error: "브랜드명을 입력해 주세요." };
  const supabase = await createClient();
  const { error } = await supabase.from("brands").insert({ client_id: clientId, name });
  if (error) return { error: friendly(error.message, error.code) };
  revalidatePath(`/clients/${clientId}`);
  return { error: "", ok: "추가했습니다." };
}

const PLATFORMS = ["naver_searchad", "naver_gfa", "meta", "naver_place", "kakao", "other"];

export async function addAccount(clientId: string, _p: FormState, f: FormData): Promise<FormState> {
  const brand_id = s(f, "brand_id");
  const platform = s(f, "platform");
  let external_id = s(f, "external_id");
  if (!brand_id || !platform || !PLATFORMS.includes(platform) || !external_id)
    return { error: "브랜드·매체·계정 번호를 모두 입력해 주세요." };
  if (platform === "meta") external_id = external_id.replace(/^act_/i, "");
  const supabase = await createClient();
  const { error } = await supabase.from("media_accounts").insert({
    brand_id,
    platform,
    external_id,
    account_name: s(f, "account_name"),
  });
  if (error) return { error: friendly(error.message, error.code) };
  revalidatePath(`/clients/${clientId}`);
  return { error: "", ok: "연결했습니다." };
}

export async function addContact(clientId: string, _p: FormState, f: FormData): Promise<FormState> {
  const name = s(f, "name");
  if (!name) return { error: "이름을 입력해 주세요." };
  const supabase = await createClient();
  const { error } = await supabase.from("client_contacts").insert({
    client_id: clientId,
    name,
    role_label: s(f, "role_label"),
    phone: s(f, "phone"),
    email: s(f, "email"),
  });
  if (error) return { error: friendly(error.message, error.code) };
  revalidatePath(`/clients/${clientId}`);
  return { error: "", ok: "추가했습니다." };
}

export async function addAlias(clientId: string, _p: FormState, f: FormData): Promise<FormState> {
  const alias = s(f, "alias");
  if (!alias) return { error: "이름을 입력해 주세요." };
  const supabase = await createClient();
  const { error } = await supabase.from("name_aliases").insert({ client_id: clientId, alias, source: "manual" });
  if (error) return { error: friendly(error.message, error.code) };
  revalidatePath(`/clients/${clientId}`);
  return { error: "", ok: "추가했습니다." };
}

// 사업자등록증 등 서류 등록 (파일은 화면에서 보관함에 먼저 올라감)
export async function addClientDocument(clientId: string, _p: FormState, f: FormData): Promise<FormState> {
  const files = parseUploaded(f.get("files"), "clients/documents");
  if (!files.length) return { error: "파일을 골라 주세요." };
  const type = s(f, "document_type") ?? "business_registration";
  if (!["business_registration", "bank_account", "other"].includes(type)) return { error: "서류 종류를 골라 주세요." };
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("my_staff_id");
  const { error } = await supabase.from("client_documents").insert(
    files.map((x) => ({ client_id: clientId, document_type: type, file_name: x.name, storage_path: x.path, mime_type: x.type, file_size: x.size, uploaded_by: me })),
  );
  if (error) return { error: friendly(error.message, error.code) };
  revalidatePath(`/clients/${clientId}`);
  return { error: "", ok: "올렸습니다." };
}
