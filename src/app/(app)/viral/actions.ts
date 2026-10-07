"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeName, type ImportPlan } from "@/lib/viral-import";
import { loadSheetPlan } from "./data";
import { createClient, getMe } from "@/lib/supabase/server";

export type FormState = { error: string; ok?: string };

const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v.length ? v : null;
};
const money = (f: FormData, k: string) => {
  const v = s(f, k);
  if (v === null) return null;
  const n = Number(v.replace(/[,원\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
};

function friendly(message: string) {
  if (message.includes("row-level security")) return "이 건을 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요.";
  if (message.includes("브랜드")) return message;
  return "저장하지 못했습니다: " + message;
}

function orderFields(f: FormData) {
  const client_id = s(f, "client_id");
  const partner_id = s(f, "partner_id");
  const paid_date = s(f, "paid_date");
  const sale = money(f, "sale_amount");
  const cost = money(f, "cost_amount");
  if (!client_id) return { error: "거래처를 골라 주세요." } as const;
  if (!partner_id) return { error: "협력사를 골라 주세요." } as const;
  if (!paid_date) return { error: "입금일(시작일)을 입력해 주세요." } as const;
  if (sale === null || Number.isNaN(sale)) return { error: "판매가를 숫자로 입력해 주세요." } as const;
  if (Number.isNaN(cost)) return { error: "공급가를 숫자로 입력해 주세요." } as const;
  const start = s(f, "start_date");
  const end = s(f, "end_date");
  if (start && end && end < start) return { error: "끝나는 날이 시작일보다 빠릅니다." } as const;
  return {
    row: {
      client_id,
      brand_id: s(f, "brand_id"),
      partner_id,
      paid_date,
      start_date: start,
      end_date: end,
      description: s(f, "description"),
      sale_amount: sale,
      cost_amount: cost ?? 0,
      memo: s(f, "memo"),
    },
  } as const;
}

export async function createViralOrder(_p: FormState, f: FormData): Promise<FormState> {
  const parsed = orderFields(f);
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("viral_orders").insert(parsed.row).select("id").single();
  if (error) return { error: friendly(error.message) };
  revalidatePath("/viral");
  redirect(`/viral/${data.id}`);
}

export async function updateViralOrder(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const parsed = orderFields(f);
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("viral_orders").update(parsed.row).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 건을 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요." };
  revalidatePath(`/viral/${id}`);
  revalidatePath("/viral");
  return { error: "", ok: "저장했습니다." };
}

// 진행 상태(입금·세금계산서·협력사 결제)만 바꾸기
export async function updateViralStatus(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const invoice = s(f, "invoice_status") ?? "not_issued";
  if (!["not_issued", "requested", "issued", "not_needed"].includes(invoice)) return { error: "세금계산서 상태가 올바르지 않습니다." };
  const paidAmt = money(f, "partner_paid_amount");
  const invAmt = money(f, "partner_invoice_amount");
  if (Number.isNaN(paidAmt) || Number.isNaN(invAmt)) return { error: "금액은 숫자로 입력해 주세요." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("viral_orders")
    .update({
      payment_received: f.get("payment_received") === "on",
      payment_note: s(f, "payment_note"),
      invoice_status: invoice,
      invoice_issued_at: invoice === "issued" ? s(f, "invoice_issued_at") : null,
      partner_paid: f.get("partner_paid") === "on",
      partner_paid_amount: paidAmt,
      partner_invoice_amount: invAmt,
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 건을 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요." };
  revalidatePath(`/viral/${id}`);
  revalidatePath("/viral");
  return { error: "", ok: "상태를 저장했습니다." };
}

// ------------------------------------------------------------------ 구글 시트 옮기기

export type ImportResult = {
  error: string;
  done?: { clientsCreated: number; clientsMatched: number; ordersSaved: number; unknownManagers: string[] };
};

export async function runViralImport(): Promise<ImportResult> {
  const { supabase, me } = await getMe();
  if (!me || (me.role !== "ceo" && me.role !== "lead")) return { error: "대표·팀장만 옮길 수 있습니다." };

  let plan: ImportPlan;
  try {
    plan = await loadSheetPlan();
  } catch (e) {
    return { error: (e as Error).message };
  }

  const [{ data: staff }, { data: partners }, { data: clients }, { data: aliases }] = await Promise.all([
    supabase.from("staff").select("id,name"),
    supabase.from("viral_partners").select("id,name"),
    supabase.from("clients").select("id,business_number,company_name"),
    supabase.from("name_aliases").select("client_id,normalized"),
  ]);
  const staffId = new Map((staff ?? []).map((x) => [x.name, x.id]));
  const partnerId = new Map((partners ?? []).map((x) => [x.name, x.id]));
  const byBn = new Map((clients ?? []).filter((c) => c.business_number).map((c) => [c.business_number!, c.id]));
  const byName = new Map<string, string>();
  for (const c of clients ?? []) byName.set(normalizeName(c.company_name), c.id);
  for (const a of aliases ?? []) byName.set(a.normalized, a.client_id);

  // 1) 거래처 맞추기·만들기
  const clientIdForKey = new Map<string, string>();
  let created = 0;
  let matched = 0;
  for (const c of plan.clients) {
    let id =
      (c.businessNumber && byBn.get(c.businessNumber)) ||
      (!c.businessNumber && [c.companyName, ...c.otherNames].map((n) => byName.get(normalizeName(n))).find(Boolean)) ||
      null;
    if (id) {
      matched++;
      // 비어 있는 칸만 시트 정보로 채움 (이미 입력된 값은 건드리지 않음)
      const { data: cur } = await supabase
        .from("clients")
        .select("representative_name,address,billing_emails")
        .eq("id", id)
        .single();
      const patch: Record<string, unknown> = {};
      if (cur && !cur.representative_name && c.representativeName) patch.representative_name = c.representativeName;
      if (cur && !cur.address && c.address) patch.address = c.address;
      if (cur && !cur.billing_emails?.length && c.billingEmails.length) patch.billing_emails = c.billingEmails;
      if (Object.keys(patch).length) await supabase.from("clients").update(patch).eq("id", id);
    } else {
      const { data, error } = await supabase
        .from("clients")
        .insert({
          company_name: c.companyName,
          business_number: c.businessNumber,
          representative_name: c.representativeName,
          address: c.address,
          billing_emails: c.billingEmails,
          kinds: ["viral"],
          memo: c.hasRegistration ? "구글 시트에 사업자등록증 첨부 'Y' 표시 — 파일은 따로 올려 주세요" : null,
        })
        .select("id")
        .single();
      if (error) return { error: `거래처 '${c.companyName}'를 만들지 못했습니다: ${error.message}` };
      id = data.id;
      created++;
    }
    clientIdForKey.set(c.key, id!);
    for (const n of [c.companyName, ...c.otherNames]) {
      // 같은 이름이 이미 있으면(중복) 그냥 넘어감
      await supabase.from("name_aliases").insert({ client_id: id, alias: n, source: "viral" });
    }
  }

  // 2) 바이럴 건 저장 (시트 탭+줄 기준으로 덮어써서 여러 번 실행해도 중복 없음)
  const unknownManagers = new Set<string>();
  const rows = plan.orders.map((o) => {
    const sid = staffId.get(o.manager) ?? null;
    if (!sid) unknownManagers.add(o.manager);
    return {
      client_id: clientIdForKey.get(o.clientKey)!,
      partner_id: partnerId.get(o.tab)!,
      staff_id: sid,
      paid_date: o.paidDate,
      description: o.description,
      sale_amount: o.saleAmount,
      cost_amount: o.costAmount,
      payment_received: o.paymentReceived,
      payment_note: o.paymentNote,
      invoice_status: o.invoiceIssued ? "issued" : "not_issued",
      partner_paid: o.partnerPaid,
      partner_paid_amount: o.partnerPaidAmount,
      partner_invoice_amount: o.partnerInvoiceAmount,
      memo: sid ? null : `시트 담당자: ${o.manager}`,
      source_sheet: o.tab,
      source_row: o.row,
    };
  });
  let saved = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from("viral_orders").upsert(chunk, { onConflict: "source_sheet,source_row" });
    if (error) return { error: `${i + 1}번째 건부터 저장하지 못했습니다: ${error.message}` };
    saved += chunk.length;
  }

  revalidatePath("/viral");
  revalidatePath("/clients");
  return {
    error: "",
    done: { clientsCreated: created, clientsMatched: matched, ordersSaved: saved, unknownManagers: [...unknownManagers] },
  };
}
