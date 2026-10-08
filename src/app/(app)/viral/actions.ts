"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { groupOrders, normalizeName, type ImportPlan } from "@/lib/viral-import";
import { PRODUCT_TYPES, sheetSaleToNet } from "@/lib/viral-products";
import { calcEstimateLine } from "@/lib/billing-calc";

// 시트에 "(파생)"으로 적힌 건의 파생 실적자
const DERIVED_STAFF_NAME = "서진원";
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
  // 환불·취소는 마이너스로 입력 (예: -132,000)
  const n = Number(v.replace(/[,원\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

function friendly(message: string) {
  if (message.includes("row-level security")) return "이 건을 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요.";
  if (message.includes("브랜드") || message.includes("권한이 있는 사람만")) return message;
  return "저장하지 못했습니다: " + message;
}

type ItemInput = {
  id?: string;
  sort_order: number;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  cost_amount?: number; // 공급가 보기 권한이 없는 화면에서는 보내지 않음 → 데이터베이스가 단가표로 채움
  sale_amount: number;
  incentive_excluded: boolean;
  product_type: string | null;
  platform: string | null;
  product_name: string | null;
  days: number | null;
  quantity: number | null;
};

function parseItems(f: FormData): { items: ItemInput[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(String(f.get("items") ?? "[]"));
  } catch {
    return { error: "상품 줄을 읽지 못했습니다. 새로고침 후 다시 시도해 주세요." };
  }
  if (!Array.isArray(raw)) return { error: "상품 줄을 읽지 못했습니다." };
  const items: ItemInput[] = [];
  for (const [idx, r] of raw.entries()) {
    const it = r as Partial<ItemInput>;
    const empty = !it.description && !it.sale_amount && !it.cost_amount && !it.product_type;
    if (empty) continue; // 아무것도 안 적은 줄은 무시
    const hasCost = it.cost_amount !== undefined;
    if (!Number.isFinite(it.sale_amount) || (hasCost && !Number.isFinite(it.cost_amount)))
      return { error: `상품 ${idx + 1}줄의 금액을 숫자로 입력해 주세요.` };
    if (it.start_date && it.end_date && it.end_date < it.start_date)
      return { error: `상품 ${idx + 1}줄의 끝나는 날이 시작일보다 빠릅니다.` };
    items.push({
      id: typeof it.id === "string" ? it.id : undefined,
      sort_order: idx,
      description: it.description ?? null,
      start_date: it.start_date ?? null,
      end_date: it.end_date ?? null,
      ...(hasCost ? { cost_amount: Math.round(it.cost_amount!) } : {}),
      sale_amount: Math.round(it.sale_amount!),
      incentive_excluded: it.incentive_excluded === true,
      product_type: it.product_type && (PRODUCT_TYPES as readonly string[]).includes(it.product_type) ? it.product_type : null,
      platform: typeof it.platform === "string" && it.platform.trim() ? it.platform.trim().slice(0, 30) : null,
      product_name: typeof it.product_name === "string" && it.product_name.trim() ? it.product_name.trim().slice(0, 60) : null,
      days: Number.isInteger(it.days) && (it.days as number) > 0 ? (it.days as number) : null,
      quantity: Number.isFinite(it.quantity) && (it.quantity as number) >= 0 ? (it.quantity as number) : null,
    });
  }
  if (!items.length) return { error: "상품을 한 줄 이상 입력해 주세요." };
  return { items };
}

function orderFields(f: FormData) {
  const client_id = s(f, "client_id");
  const partner_id = s(f, "partner_id");
  if (!client_id) return { error: "거래처를 골라 주세요." } as const;
  if (!partner_id) return { error: "협력사를 골라 주세요." } as const;
  const parsed = parseItems(f);
  if ("error" in parsed) return { error: parsed.error } as const;
  const row: Record<string, unknown> = {
    client_id,
    brand_id: s(f, "brand_id"),
    partner_id,
    paid_date: s(f, "paid_date"),
    memo: s(f, "memo"),
  };
  // 파생 실적자 칸은 대표·팀장 화면에만 있음. 칸이 없으면 기존 값 유지
  if (f.has("derived_staff_id")) row.derived_staff_id = s(f, "derived_staff_id");
  if (s(f, "staff_id")) row.staff_id = s(f, "staff_id");
  return { row, items: parsed.items } as const;
}

export async function createViralOrder(_p: FormState, f: FormData): Promise<FormState> {
  const parsed = orderFields(f);
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  // 담당자·파생 실적자 지정은 대표·팀장만 (직원은 본인 담당으로 자동)
  if (me.role === "staff") {
    delete parsed.row.staff_id;
    delete parsed.row.derived_staff_id;
  }
  // 건과 상품 줄을 한 번에 저장 (상품 줄이 실패하면 건도 남지 않음)
  const items = parsed.items.map(({ id: _drop, ...i }) => { void _drop; return i; });
  const { data: newId, error } = await supabase.rpc("viral_create_order", { p_order: parsed.row, p_items: items });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/viral");
  redirect(`/viral/${newId}`);
}

export async function updateViralOrder(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const parsed = orderFields(f);
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  if (me.role === "staff") {
    delete parsed.row.staff_id;
    delete parsed.row.derived_staff_id;
  }
  const { data, error } = await supabase.from("viral_orders").update(parsed.row).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 건을 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요." };

  // 상품 줄 맞추기: 화면에서 지운 줄은 삭제, 있던 줄은 수정, 새 줄은 추가
  const { data: current } = await supabase.from("viral_order_items").select("id").eq("order_id", id);
  const keep = new Set(parsed.items.map((i) => i.id).filter(Boolean));
  const removed = (current ?? []).map((r) => r.id).filter((x) => !keep.has(x));
  if (removed.length) {
    const { error: delErr } = await supabase.from("viral_order_items").delete().in("id", removed);
    if (delErr) return { error: friendly(delErr.message) };
  }
  for (const it of parsed.items) {
    const { id: itemId, ...fields } = it;
    const res = itemId
      ? await supabase.from("viral_order_items").update(fields).eq("id", itemId).eq("order_id", id)
      : await supabase.from("viral_order_items").insert({ ...fields, order_id: id });
    if (res.error) return { error: friendly(res.error.message) };
  }
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
      // 협력사 결제 금액 칸은 공급가 보기 권한이 있는 화면에만 있음
      ...(f.has("partner_paid_amount") ? { partner_paid_amount: paidAmt, partner_invoice_amount: invAmt } : {}),
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
  done?: { clientsCreated: number; clientsMatched: number; ordersSaved: number; itemsSaved: number; unknownManagers: string[] };
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
  const provisional = new Set((clients ?? []).filter((c) => !c.business_number).map((c) => c.id));

  // 1) 거래처 맞추기·만들기
  const clientIdForKey = new Map<string, string>();
  let created = 0;
  let matched = 0;
  for (const c of plan.clients) {
    const sameName = [c.companyName, ...c.otherNames].map((n) => byName.get(normalizeName(n))).find(Boolean);
    let id =
      (c.businessNumber && byBn.get(c.businessNumber)) ||
      (!c.businessNumber && sameName) ||
      // 시트에 사업자번호가 있고 같은 이름의 '임시 거래처'(사업자번호 없음)가 있으면 그 거래처에 번호를 채워 넣음
      (c.businessNumber && sameName && provisional.has(sameName) ? sameName : null) ||
      null;
    if (id) {
      matched++;
      if (c.businessNumber && provisional.has(id)) {
        const { error } = await supabase.from("clients").update({ business_number: c.businessNumber }).eq("id", id);
        if (!error) {
          provisional.delete(id);
          byBn.set(c.businessNumber, id);
        }
      }
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

  // 2) 바이럴 건 저장: 같은 업체·입금일·협력사·담당 줄을 1건으로 묶고, 줄은 상품 줄로 저장
  //    (건은 묶음 키, 상품 줄은 시트 탭+행 기준으로 덮어써서 여러 번 실행해도 중복 없음)
  const groups = groupOrders(plan.orders);
  const unknownManagers = new Set<string>();
  const derivedStaffId = staffId.get(DERIVED_STAFF_NAME) ?? null;
  const orderRows = groups.map((g) => {
    const sid = staffId.get(g.manager) ?? null;
    if (!sid) unknownManagers.add(g.manager);
    const memo = [
      !sid ? `시트 담당자: ${g.managerLabels[0] ?? g.manager} (직원 목록에 없음)` : g.managerLabels.length ? `시트 담당자 표기: ${g.managerLabels.join(", ")}` : null,
      ...g.saleNotes.map((n) => `시트 판매가 칸: ${n}`),
    ]
      .filter(Boolean)
      .join(" / ");
    return {
      import_key: g.key,
      client_id: clientIdForKey.get(g.clientKey)!,
      partner_id: partnerId.get(g.tab)!,
      staff_id: sid,
      derived_staff_id: g.derived ? derivedStaffId : null,
      paid_date: g.paidDate,
      payment_received: g.paymentReceived,
      payment_note: g.paymentNotes.join(" / ") || null,
      invoice_status: g.invoiceIssued ? "issued" : "not_issued",
      partner_paid: g.partnerPaid,
      partner_paid_amount: g.partnerPaidAmount,
      partner_invoice_amount: g.partnerInvoiceAmount,
      memo: memo || null,
      source_sheet: g.tab,
    };
  });

  const orderIdForKey = new Map<string, string>();
  for (let i = 0; i < orderRows.length; i += 200) {
    const chunk = orderRows.slice(i, i + 200);
    // 이미 가져온 건은 건드리지 않음 (통합 시스템에서 바꾼 입금·계산서·담당 상태를 시트 값으로 덮어쓰지 않게) → 새 건만 추가
    const { error } = await supabase.from("viral_orders").upsert(chunk, { onConflict: "import_key", ignoreDuplicates: true });
    if (error) return { error: `바이럴 건 저장 중 문제가 생겼습니다(${i + 1}번째 묶음부터): ${error.message}` };
    const { data } = await supabase.from("viral_orders").select("id,import_key").in("import_key", chunk.map((r) => r.import_key));
    for (const r of data ?? []) orderIdForKey.set(r.import_key, r.id);
  }

  const itemRows = groups.flatMap((g) =>
    g.items.map((o, idx) => ({
      order_id: orderIdForKey.get(g.key)!,
      sort_order: idx,
      description: o.description,
      start_date: o.startDate,
      end_date: o.endDate,
      sale_amount: sheetSaleToNet(o.saleAmount),
      cost_amount: o.costAmount,
      source_sheet: o.tab,
      source_row: o.row,
    })),
  );
  let saved = 0;
  for (let i = 0; i < itemRows.length; i += 200) {
    const chunk = itemRows.slice(i, i + 200);
    const { error } = await supabase.from("viral_order_items").upsert(chunk, { onConflict: "source_sheet,source_row", ignoreDuplicates: true });
    if (error) {
      // 묶음이 거절되면 한 줄씩 다시 넣어서, 어느 시트 몇 행이 문제인지 찾아 알려줌
      const failed: string[] = [];
      for (const r of chunk) {
        const one = await supabase.from("viral_order_items").upsert(r, { onConflict: "source_sheet,source_row", ignoreDuplicates: true });
        if (one.error) failed.push(`${r.source_sheet} ${r.source_row}행 (${one.error.message})`);
        else saved++;
      }
      if (failed.length)
        return {
          error: `${saved}줄은 저장했고, ${failed.length}줄은 저장하지 못했습니다: ${failed.slice(0, 5).join(" / ")}${failed.length > 5 ? " …" : ""}`,
        };
      continue;
    }
    saved += chunk.length;
  }

  revalidatePath("/viral");
  revalidatePath("/clients");
  return {
    error: "",
    done: { clientsCreated: created, clientsMatched: matched, ordersSaved: orderIdForKey.size, itemsSaved: saved, unknownManagers: [...unknownManagers] },
  };
}

// ---------------------------------------------------------------- 환불 · 미소진 잔액
const CREDIT_ENTRIES: Record<string, "refund" | "prepaid"> = {
  refund_issued: "refund",
  refund_paid: "refund",
  refund_applied: "refund",
  prepaid_received: "prepaid",
  prepaid_used: "prepaid",
};

export async function addViralCredit(orderId: string, clientId: string, _p: FormState, f: FormData): Promise<FormState> {
  const entry = s(f, "entry") ?? "";
  const kind = CREDIT_ENTRIES[entry];
  if (!kind) return { error: "기록 종류를 골라 주세요." };
  const amount = money(f, "amount");
  if (!amount || Number.isNaN(amount) || amount <= 0) return { error: "금액을 0보다 크게 입력해 주세요." };
  const partnerRefund = money(f, "partner_refund") ?? 0;
  if (Number.isNaN(partnerRefund) || partnerRefund < 0) return { error: "협력사 환불 금액을 확인해 주세요." };
  const supabase = await createClient();
  const { error } = await supabase.from("viral_credits").insert({
    client_id: clientId,
    order_id: orderId,
    item_id: s(f, "item_id"),
    kind,
    entry,
    amount,
    partner_refund: entry === "refund_issued" ? partnerRefund : 0,
    occurred_on: s(f, "occurred_on") ?? undefined,
    memo: s(f, "memo"),
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/viral/${orderId}`);
  revalidatePath("/viral/balances");
  return { error: "", ok: "기록했습니다." };
}

export async function deleteViralCredit(orderId: string, creditId: string) {
  const supabase = await createClient();
  await supabase.from("viral_credits").delete().eq("id", creditId);
  revalidatePath(`/viral/${orderId}`);
  revalidatePath("/viral/balances");
}

// ---------------------------------------------------------------- 견적서 자동 만들기
export async function createEstimateFromOrder(orderId: string) {
  const { supabase, me } = await getMe();
  if (!me) redirect("/login");
  const { data: o } = await supabase
    .from("viral_orders")
    .select("id,client_id,billing_document_id,paid_date,clients(company_name,representative_name,business_number,address,billing_emails)")
    .eq("id", orderId)
    .maybeSingle();
  if (!o) redirect("/viral");
  if (o.billing_document_id) redirect(`/billing/${o.billing_document_id}`);
  const { data: items } = await supabase
    .from("viral_order_items")
    .select("description,product_type,platform,product_name,quantity,sale_amount")
    .eq("order_id", orderId)
    .order("sort_order")
    .order("created_at");
  const c = (Array.isArray(o.clients) ? o.clients[0] : o.clients) as {
    company_name: string; representative_name: string | null; business_number: string | null; address: string | null; billing_emails: string[];
  };
  // 판매가(VAT 별도) → 견적서 단가(VAT 포함)
  const lines = (items ?? []).filter((i) => i.sale_amount).map((i, idx) => {
    const unit = Math.round(Number(i.sale_amount) * 1.1);
    const r = calcEstimateLine(unit, 1);
    return {
      sort_order: idx + 1,
      item_name: [i.platform, i.product_type === "슬롯" ? "리워드" : i.product_type].filter(Boolean).join(" ") || "바이럴",
      description: i.description,
      unit_price: unit,
      quantity: 1,
      supply_amount: r.supply,
      vat_amount: r.vat,
      total_amount: r.total,
    };
  });
  const supply = lines.reduce((t, l) => t + l.supply_amount, 0);
  const vat = lines.reduce((t, l) => t + l.vat_amount, 0);
  const { data: doc, error } = await supabase
    .from("billing_documents")
    .insert({
      doc_type: "viral_estimate",
      supplier_code: "ga",
      client_id: o.client_id,
      recipient_company_name: c.company_name,
      recipient_representative_name: c.representative_name,
      recipient_business_number: c.business_number,
      recipient_address: c.address,
      recipient_emails: c.billing_emails ?? [],
      supply_amount: supply,
      vat_amount: vat,
      total_amount: supply + vat,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !doc) redirect(`/viral/${orderId}?estimate_error=1`);
  if (lines.length) {
    const { error: itemErr } = await supabase.from("billing_items").insert(lines.map((l) => ({ ...l, billing_document_id: doc.id })));
    if (itemErr) {
      // 품목이 안 들어간 빈 견적서는 남기지 않음 (작성 중 문서라 본인이 지울 수 있음)
      await supabase.from("billing_documents").delete().eq("id", doc.id).eq("status", "draft");
      redirect(`/viral/${orderId}?estimate_error=1`);
    }
  }
  const { error: linkErr } = await supabase.from("viral_orders").update({ billing_document_id: doc.id }).eq("id", orderId);
  if (linkErr) redirect(`/billing/${doc.id}?link_error=1`);
  revalidatePath(`/viral/${orderId}`);
  redirect(`/billing/${doc.id}`);
}

// ---------------------------------------------------------------- 협력사 단가표 (대표·팀장)
export async function savePrice(id: string | null, _p: FormState, f: FormData): Promise<FormState> {
  const partner_id = s(f, "partner_id");
  const product_type = s(f, "product_type");
  if (!partner_id || !product_type || !(PRODUCT_TYPES as readonly string[]).includes(product_type)) return { error: "협력사와 상품 종류를 골라 주세요." };
  const cost = money(f, "cost_price");
  // 판매가 칸: VAT 포함인지 별도인지 함께 저장
  const sale = money(f, "sale_price");
  const saleIncludesVat = s(f, "sale_vat_mode") === "included";
  if (cost === null || sale === null || Number.isNaN(cost) || Number.isNaN(sale) || cost < 0 || sale < 0) return { error: "공급가·판매가를 숫자로 입력해 주세요." };
  const daysRaw = s(f, "days");
  const days = daysRaw ? Number(daysRaw) : null;
  if (days !== null && (!Number.isInteger(days) || days <= 0)) return { error: "일수를 확인해 주세요." };
  const row = {
    partner_id,
    product_type,
    platform: s(f, "platform"),
    product_name: s(f, "product_name"),
    days,
    unit_label: s(f, "unit_label") ?? (product_type === "슬롯" ? "슬롯" : "건"),
    cost_price: cost,
    sale_price: sale,
    sale_includes_vat: saleIncludesVat,
    memo: s(f, "memo"),
  };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("viral_price_list").update(row).eq("id", id).select("id")
    : await supabase.from("viral_price_list").insert(row).select("id");
  if (error) return { error: error.code === "23505" ? "같은 조건의 단가가 이미 있습니다. 그 줄을 고쳐 주세요." : friendly(error.message) };
  if (!data?.length) return { error: "대표·팀장만 단가를 바꿀 수 있습니다." };
  revalidatePath("/viral/prices");
  return { error: "", ok: "저장했습니다." };
}

export async function deletePrice(id: string) {
  const supabase = await createClient();
  await supabase.from("viral_price_list").delete().eq("id", id);
  revalidatePath("/viral/prices");
}
