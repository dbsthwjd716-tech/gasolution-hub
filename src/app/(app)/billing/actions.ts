"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { calcEstimate, calcEstimateLine, calcSettlement, type DocType, type MarkupType } from "@/lib/billing-calc";
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
const DOC_TYPES: DocType[] = ["settlement", "viral_estimate", "detailed_estimate", "simple_estimate"];

function friendly(message: string) {
  if (message.includes("row-level security")) return "이 문서를 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요.";
  if (/권한|승인된 문서|새 문서/.test(message)) return message;
  return "저장하지 못했습니다: " + message;
}

type Line = { item_name: string; description: string | null; unit_price: number; quantity: number };

function parseLines(f: FormData): Line[] | string {
  let raw: unknown;
  try {
    raw = JSON.parse(String(f.get("items") ?? "[]"));
  } catch {
    return "품목을 읽지 못했습니다. 새로고침 후 다시 시도해 주세요.";
  }
  if (!Array.isArray(raw)) return "품목을 읽지 못했습니다.";
  const out: Line[] = [];
  for (const [i, r] of raw.entries()) {
    const it = r as Partial<Line>;
    const name = String(it.item_name ?? "").trim();
    const unit = Number(it.unit_price);
    const qty = Number(it.quantity);
    if (!name && !unit) continue;
    if (!name) return `${i + 1}번째 품목의 품명을 적어 주세요.`;
    if (!Number.isFinite(unit) || !Number.isFinite(qty) || qty <= 0) return `${i + 1}번째 품목의 단가·수량을 확인해 주세요.`;
    out.push({ item_name: name, description: String(it.description ?? "").trim() || null, unit_price: Math.round(unit), quantity: qty });
  }
  return out;
}

// 정산·견적 저장 (새로 만들기 / 고치기). intent: draft(임시 저장) · requested(승인 요청)
export async function saveBilling(id: string | null, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const docType = s(f, "doc_type") as DocType;
  if (!DOC_TYPES.includes(docType)) return { error: "문서 종류를 골라 주세요." };
  const intent = s(f, "intent") === "requested" ? "requested" : "draft";
  const clientId = s(f, "client_id");
  if (!clientId) return { error: "거래처를 골라 주세요." };

  const { data: c } = await supabase
    .from("clients")
    .select("company_name,business_number,representative_name,address,billing_emails")
    .eq("id", clientId)
    .maybeSingle();
  if (!c) return { error: "거래처를 찾을 수 없습니다." };

  let existing: { status: string; doc_type: string } | null = null;
  let existingFiles = 0;
  if (id) {
    const { data } = await supabase.from("billing_documents").select("status,doc_type").eq("id", id).maybeSingle();
    if (!data) return { error: "문서를 찾을 수 없습니다." };
    if (!["draft", "requested", "rejected"].includes(data.status))
      return { error: "승인이 진행된 문서는 고칠 수 없습니다. 반려 후 수정해 주세요." };
    existing = data;
    const { count } = await supabase.from("billing_files").select("id", { count: "exact", head: true }).eq("billing_document_id", id);
    existingFiles = count ?? 0;
  }

  const files = parseUploaded(f.get("evidence"), "billing/evidence");
  const adjustment = Math.round(num(f, "adjustment"));
  const adjustmentReason = s(f, "adjustment_reason");
  if (!Number.isFinite(adjustment)) return { error: "추가/차감 금액을 숫자로 입력해 주세요." };
  if (adjustment !== 0 && !adjustmentReason) return { error: "추가/차감 금액이 있으면 사유를 적어 주세요." };

  const row: Record<string, unknown> = {
    doc_type: docType,
    supplier_code: s(f, "supplier_code") ?? "ga",
    client_id: clientId,
    document_date: s(f, "document_date") ?? undefined,
    recipient_company_name: c.company_name,
    recipient_representative_name: c.representative_name,
    recipient_business_number: c.business_number,
    recipient_address: c.address,
    recipient_emails: c.billing_emails ?? [],
    adjustment_amount: adjustment,
    adjustment_reason: adjustment ? adjustmentReason : null,
    note: s(f, "note"),
  };
  let items: (Line & { supply_amount: number; vat_amount: number; total_amount: number })[] = [];

  if (docType === "settlement") {
    const markupType = (s(f, "markup_type") ?? "rate") as MarkupType;
    if (!["rate", "fixed", "none"].includes(markupType)) return { error: "마크업 방식을 골라 주세요." };
    const input = {
      spend: num(f, "spend_amount"),
      markupType,
      markupRate: markupType === "rate" ? num(f, "markup_rate") : 0,
      markupFixed: markupType === "fixed" ? num(f, "markup_fixed") : 0,
      minFee: num(f, "min_fee"),
      vatMode: s(f, "vat_mode") === "excluded" ? ("excluded" as const) : ("included" as const),
      adjustment,
    };
    if (![input.spend, input.markupRate, input.markupFixed, input.minFee].every((n) => Number.isFinite(n) && n >= 0))
      return { error: "광고비·요율·금액은 0 이상의 숫자로 입력해 주세요." };
    const periodStart = s(f, "period_start");
    const periodEnd = s(f, "period_end");
    if (!periodStart || !periodEnd) return { error: "정산 기간을 입력해 주세요." };
    if (periodEnd < periodStart) return { error: "정산 종료일이 시작일보다 빠릅니다." };
    if (intent === "requested") {
      if (!c.business_number) return { error: "사업자번호가 없는 임시 거래처입니다. 거래처에 사업자번호를 먼저 넣어 주세요." };
      if (!files.length && !existingFiles) return { error: "광고비 소진 증빙(캡처·PDF)을 1개 이상 올려 주세요." };
    }
    const r = calcSettlement(input);
    Object.assign(row, {
      contract_id: s(f, "contract_id"),
      period_start: periodStart,
      period_end: periodEnd,
      spend_amount: Math.round(input.spend),
      markup_type: markupType,
      markup_rate: input.markupRate,
      markup_fixed: Math.round(input.markupFixed),
      min_fee: Math.round(input.minFee),
      vat_mode: input.vatMode,
      markup_amount: r.markup,
      supply_amount: r.supply,
      vat_amount: r.vat,
      total_amount: r.total,
    });
    const basis =
      markupType === "rate" ? `광고비 소진액 ${Math.round(input.spend).toLocaleString("ko-KR")}원 × ${input.markupRate}%` : null;
    items = [
      {
        item_name: "광고대행 마크업 비용",
        description: [s(f, "item_description"), basis, r.minApplied ? "최소 대행비 적용" : null].filter(Boolean).join(" / ") || null,
        unit_price: r.supply + r.vat,
        quantity: 1,
        supply_amount: r.supply,
        vat_amount: r.vat,
        total_amount: r.supply + r.vat,
      },
    ];
  } else {
    const lines = parseLines(f);
    if (typeof lines === "string") return { error: lines };
    if (!lines.length) return { error: "품목을 1개 이상 입력해 주세요." };
    const e = calcEstimate(lines.map((l) => ({ unitPrice: l.unit_price, quantity: l.quantity })), adjustment);
    Object.assign(row, {
      contract_id: null,
      period_start: null,
      period_end: null,
      spend_amount: 0,
      markup_type: "none",
      markup_rate: 0,
      markup_fixed: 0,
      min_fee: 0,
      vat_mode: "included",
      markup_amount: 0,
      supply_amount: e.supply,
      vat_amount: e.vat,
      total_amount: e.total,
    });
    items = lines.map((l) => {
      const r = calcEstimateLine(l.unit_price, l.quantity);
      return { ...l, supply_amount: r.supply, vat_amount: r.vat, total_amount: r.total };
    });
  }

  let docId = id;
  if (!id) {
    const { data, error } = await supabase.from("billing_documents").insert({ ...row, status: intent }).select("id").single();
    if (error) return { error: friendly(error.message) };
    docId = data.id;
  } else {
    // 먼저 내용을 고친 뒤(작성중/반려 상태에서) 요청 상태로 바꿈
    const { data, error } = await supabase.from("billing_documents").update(row).eq("id", id).select("id");
    if (error) return { error: friendly(error.message) };
    if (!data?.length) return { error: "이 문서를 수정할 권한이 없습니다." };
  }

  // 품목 바꾸기: 새 품목을 먼저 넣고, 성공하면 예전 품목을 지움 (중간에 실패해도 품목이 비지 않음)
  const { data: oldItems } = await supabase.from("billing_items").select("id").eq("billing_document_id", docId!);
  const { error: itemErr } = await supabase
    .from("billing_items")
    .insert(items.map((it, i) => ({ ...it, billing_document_id: docId, sort_order: i + 1 })));
  if (itemErr) {
    // 새로 만든 문서에서 품목이 실패하면 빈 문서를 남기지 않음 (다시 눌러도 중복 문서가 생기지 않게)
    if (!id) await supabase.from("billing_documents").delete().eq("id", docId!);
    return { error: friendly(itemErr.message) };
  }
  if (oldItems?.length) {
    const { error: delErr } = await supabase.from("billing_items").delete().in("id", oldItems.map((x) => x.id));
    if (delErr) return { error: friendly(delErr.message) };
  }
  if (files.length) {
    const { error: fileErr } = await supabase.from("billing_files").insert(
      files.map((x) => ({ billing_document_id: docId, file_type: "spend_evidence", file_name: x.name, storage_path: x.path, mime_type: x.type, file_size: x.size })),
    );
    if (fileErr) return { error: friendly(fileErr.message) };
  }
  if (id && existing && existing.status !== intent) {
    const { error } = await supabase.from("billing_documents").update({ status: intent }).eq("id", id);
    if (error) return { error: friendly(error.message) };
  }

  revalidatePath("/billing");
  if (!id) redirect(`/billing/${docId}`);
  revalidatePath(`/billing/${id}`);
  return { error: "", ok: intent === "requested" ? "저장하고 승인 요청했습니다." : "저장했습니다." };
}

// 승인 단계 바꾸기
const STEP_TO_STATUS: Record<string, string> = {
  request: "requested",
  withdraw: "draft",
  lead_approve: "lead_approved",
  approve: "approved",
  issue: "issued",
  unissue: "approved",
  reject: "rejected",
  cancel: "cancelled",
};

export async function changeBillingStatus(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const step = s(f, "step") ?? "";
  const status = STEP_TO_STATUS[step];
  if (!status) return { error: "알 수 없는 요청입니다." };
  const patch: Record<string, unknown> = { status };
  if (status === "rejected") {
    const reason = s(f, "reason");
    if (!reason) return { error: "반려 사유를 적어 주세요." };
    patch.rejection_reason = reason;
  }
  if (step === "request") {
    const { data: d } = await supabase.from("billing_documents").select("doc_type,recipient_business_number").eq("id", id).maybeSingle();
    if (d?.doc_type === "settlement") {
      const { count } = await supabase.from("billing_files").select("id", { count: "exact", head: true }).eq("billing_document_id", id);
      if (!count) return { error: "광고비 소진 증빙을 먼저 올려 주세요." };
      if (!d.recipient_business_number) return { error: "사업자번호가 없는 거래처입니다. 거래처 정보를 채운 뒤 문서를 다시 저장해 주세요." };
    }
  }
  const { data, error } = await supabase.from("billing_documents").update(patch).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 문서를 바꿀 권한이 없습니다." };
  revalidatePath(`/billing/${id}`);
  revalidatePath("/billing");
  return { error: "", ok: "반영했습니다." };
}

export async function setBillingPayment(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const received = f.get("payment_received") === "on";
  const paidAt = s(f, "paid_at");
  const { data, error } = await supabase
    .from("billing_documents")
    .update({ payment_received: received, paid_at: received ? paidAt : null })
    .eq("id", id)
    .select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 문서를 바꿀 권한이 없습니다." };
  revalidatePath(`/billing/${id}`);
  revalidatePath("/billing");
  return { error: "", ok: "저장했습니다." };
}

export async function deleteBilling(id: string) {
  const { supabase, me } = await getMe();
  if (!me) return;
  const { data: files } = await supabase.from("billing_files").select("storage_path").eq("billing_document_id", id);
  const { data } = await supabase.from("billing_documents").delete().eq("id", id).select("id");
  if (data?.length && files?.length) await supabase.storage.from("hub-files").remove(files.map((x) => x.storage_path));
  revalidatePath("/billing");
  redirect("/billing");
}

export async function removeBillingFile(docId: string, fileId: string) {
  const { supabase } = await getMe();
  const { data } = await supabase.from("billing_files").delete().eq("id", fileId).eq("billing_document_id", docId).select("storage_path");
  if (data?.length) await supabase.storage.from("hub-files").remove(data.map((x) => x.storage_path));
  revalidatePath(`/billing/${docId}`);
}
