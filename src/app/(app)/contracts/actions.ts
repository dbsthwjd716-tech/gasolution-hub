"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/supabase/server";
import { parseUploaded } from "@/lib/uploads";

export type FormState = { error: string; ok?: string };

const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v.length ? v : null;
};
const num = (f: FormData, k: string) => {
  const v = s(f, k);
  if (v === null) return 0;
  const n = Number(v.replace(/[,원%\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const MEDIA = ["naver", "gfa", "meta", "google", "kakao", "coupang", "other"];

function friendly(message: string) {
  if (message.includes("row-level security")) return "이 계약을 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요.";
  if (/대표·팀장|브랜드/.test(message)) return message;
  return "저장하지 못했습니다: " + message;
}

function contractFields(f: FormData, isManager: boolean) {
  const client_id = s(f, "client_id");
  if (!client_id) return { error: "거래처를 골라 주세요." } as const;
  const markup_type = s(f, "markup_type") ?? "rate";
  if (!["rate", "fixed", "none"].includes(markup_type)) return { error: "마크업 방식을 골라 주세요." } as const;
  const markup_rate = markup_type === "rate" ? num(f, "markup_rate") : 0;
  const markup_fixed = markup_type === "fixed" ? Math.round(num(f, "markup_fixed")) : 0;
  const min_fee = Math.round(num(f, "min_fee"));
  if (![markup_rate, markup_fixed, min_fee].every((n) => Number.isFinite(n) && n >= 0))
    return { error: "요율·금액은 0 이상의 숫자로 입력해 주세요." } as const;
  if (markup_rate >= 100) return { error: "요율은 100% 미만이어야 합니다." } as const;
  const start_date = s(f, "start_date");
  const end_date = s(f, "end_date");
  if (start_date && end_date && end_date < start_date) return { error: "계약 종료일이 시작일보다 빠릅니다." } as const;
  const row: Record<string, unknown> = {
    client_id,
    brand_id: s(f, "brand_id"),
    contract_date: s(f, "contract_date") ?? undefined,
    start_date,
    end_date,
    media: f.getAll("media").map(String).filter((m) => MEDIA.includes(m)),
    markup_type,
    markup_rate,
    markup_fixed,
    min_fee,
    vat_mode: s(f, "vat_mode") === "excluded" ? "excluded" : "included",
    auto_renew: f.get("auto_renew") === "on",
    document_required: f.get("document_required") === "on",
    special_terms: s(f, "special_terms"),
  };
  if (isManager && s(f, "staff_id")) row.staff_id = s(f, "staff_id");
  return { row } as const;
}

export async function createContract(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const parsed = contractFields(f, me.role !== "staff");
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const { data, error } = await supabase.from("contracts").insert(parsed.row).select("id").single();
  if (error) return { error: friendly(error.message) };
  revalidatePath("/contracts");
  redirect(`/contracts/${data.id}`);
}

export async function updateContract(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const parsed = contractFields(f, me.role !== "staff");
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const { data, error } = await supabase.from("contracts").update(parsed.row).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 계약을 수정할 권한이 없습니다." };
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/contracts");
  return { error: "", ok: "저장했습니다." };
}

// 진행 단계 바꾸기: 서명 진행 / 계약 완료(서명본·계약서 없이) / 보류 / 반려 / 종료 / 다시 작성
export async function changeContractStatus(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const step = s(f, "step");
  const patch: Record<string, unknown> = {};
  switch (step) {
    case "signing":
      patch.status = "signing";
      break;
    case "draft":
      patch.status = "draft";
      patch.completion_type = null;
      break;
    case "upload_signed": {
      const files = parseUploaded(f.get("signed_file"), "contracts/signed");
      if (!files.length) return { error: "서명된 계약서(PDF)를 골라 주세요." };
      patch.signed_file_path = files[0].path;
      patch.signed_file_name = files[0].name;
      break;
    }
    case "complete_signed": {
      const files = parseUploaded(f.get("signed_file"), "contracts/signed");
      const { data: cur } = await supabase.from("contracts").select("signed_file_path").eq("id", id).maybeSingle();
      if (!files.length && !cur?.signed_file_path) return { error: "광고주가 서명한 계약서(PDF)를 먼저 올려 주세요." };
      if (files.length) {
        patch.signed_file_path = files[0].path;
        patch.signed_file_name = files[0].name;
      }
      patch.status = "active";
      patch.completion_type = "signed_document";
      break;
    }
    case "complete_no_document":
      patch.status = "active";
      patch.completion_type = "no_document";
      break;
    case "on_hold":
    case "ended":
      patch.status = step;
      break;
    case "rejected": {
      const reason = s(f, "reason");
      if (!reason) return { error: "반려 사유를 적어 주세요." };
      patch.status = "rejected";
      patch.rejection_reason = reason;
      break;
    }
    default:
      return { error: "알 수 없는 요청입니다." };
  }
  const { data, error } = await supabase.from("contracts").update(patch).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 계약을 바꿀 권한이 없습니다." };
  revalidatePath(`/contracts/${id}`);
  revalidatePath("/contracts");
  return { error: "", ok: "반영했습니다." };
}
