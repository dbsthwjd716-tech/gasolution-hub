"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CONTACT_TYPES, LEAD_STATUSES, parseInquiryAt } from "@/lib/leads";
import { getMe } from "@/lib/supabase/server";

export type FormState = { error: string; ok?: string };

const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v.length ? v : null;
};

function friendly(message: string) {
  if (message.includes("row-level security")) return "이 문의를 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요.";
  if (/대표·팀장/.test(message)) return message;
  return "저장하지 못했습니다: " + message;
}

function leadFields(f: FormData) {
  const inquiry_at = parseInquiryAt(s(f, "inquiry_at") ?? "");
  if (!inquiry_at) return { error: "문의시간을 확인해 주세요. 예: 2026년 10월 7일 화요일 14:30 또는 2026-10-07 14:30" } as const;
  const company_name = s(f, "company_name");
  if (!company_name) return { error: "업체명을 입력해 주세요." } as const;
  const budgetRaw = s(f, "monthly_budget");
  const budget = budgetRaw ? Number(budgetRaw.replace(/[^\d]/g, "")) : null;
  return {
    row: {
      inquiry_at,
      company_name,
      contact_name: s(f, "contact_name"),
      phone: s(f, "phone"),
      monthly_budget: budget,
      source: s(f, "source"),
      media: f.getAll("media").map(String).filter(Boolean),
      inquiry_content: s(f, "inquiry_content"),
      memo: s(f, "memo"),
      next_contact_on: s(f, "next_contact_on"),
    },
  } as const;
}

export async function createLead(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const parsed = leadFields(f);
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const staff = s(f, "staff_id");
  const row: Record<string, unknown> = { ...parsed.row };
  if (staff === "me") row.staff_id = me.id;
  else if (staff && me.role !== "staff") row.staff_id = staff;
  const { data, error } = await supabase.from("leads").insert(row).select("id").single();
  if (error) return { error: friendly(error.message) };
  revalidatePath("/leads");
  redirect(`/leads/${data.id}?created=1`);
}

export async function updateLead(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const parsed = leadFields(f);
  if ("error" in parsed) return { error: parsed.error ?? "" };
  const { data, error } = await supabase.from("leads").update(parsed.row).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 문의를 수정할 권한이 없습니다. 담당자나 팀장에게 요청해 주세요." };
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  return { error: "", ok: "저장했습니다." };
}

export async function setLeadStatus(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await getMe();
  const status = s(f, "status");
  if (!status || !(LEAD_STATUSES as readonly string[]).includes(status)) return { error: "상태를 골라 주세요." };
  const patch: Record<string, unknown> = { status };
  if (f.has("next_contact_on")) patch.next_contact_on = s(f, "next_contact_on");
  const { data, error } = await supabase.from("leads").update(patch).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 문의를 바꿀 권한이 없습니다. 담당자나 팀장에게 요청해 주세요." };
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  return { error: "", ok: "저장했습니다." };
}

// 담당 지정: 대표·팀장은 누구에게나, 직원은 미배정 문의를 자기 담당으로
export async function setLeadOwner(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const v = s(f, "staff_id");
  const staff_id = v === "me" ? me.id : v;
  const { data, error } = await supabase.from("leads").update({ staff_id }).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "담당을 바꿀 권한이 없습니다." };
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  return { error: "", ok: "담당을 바꿨습니다." };
}

export async function addLeadActivity(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const type = s(f, "activity_type") ?? "전화";
  if (!CONTACT_TYPES.includes(type)) return { error: "연락 방법을 골라 주세요." };
  const content = s(f, "content");
  if (!content) return { error: "상담 내용을 적어 주세요." };
  const when = s(f, "occurred_at");
  const occurred_at = when ? parseInquiryAt(when.replace("T", " ")) : new Date().toISOString();
  if (!occurred_at) return { error: "연락 일시를 확인해 주세요." };
  const { error } = await supabase.from("lead_activities").insert({ lead_id: id, activity_type: type, content, occurred_at });
  if (error) return { error: friendly(error.message) };
  // 다음 연락 예정일·상태를 함께 바꾼 경우
  const next = s(f, "next_contact_on");
  const status = s(f, "status");
  const patch: Record<string, unknown> = {};
  if (f.has("next_contact_on")) patch.next_contact_on = next;
  if (status && (LEAD_STATUSES as readonly string[]).includes(status)) patch.status = status;
  if (Object.keys(patch).length) {
    const { error: e2 } = await supabase.from("leads").update(patch).eq("id", id);
    if (e2) return { error: "상담 기록은 남겼지만 상태를 바꾸지 못했습니다: " + friendly(e2.message) };
  }
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  return { error: "", ok: "기록했습니다." };
}

export async function deleteLead(id: string) {
  const { supabase } = await getMe();
  await supabase.from("leads").delete().eq("id", id);
  revalidatePath("/leads");
  redirect("/leads");
}

// 거래처 연결: 기존 거래처 고르기 또는 문의 정보로 임시 거래처 새로 만들기
export async function linkLeadClient(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  let clientId = s(f, "client_id");
  if (clientId === "new") {
    const { data: l } = await supabase.from("leads").select("company_name,contact_name,phone").eq("id", id).maybeSingle();
    if (!l) return { error: "문의를 찾을 수 없습니다." };
    const { data: c, error } = await supabase
      .from("clients")
      .insert({ company_name: l.company_name, status: "lead", kinds: ["ad"], memo: "인입 CRM 문의에서 등록" })
      .select("id")
      .single();
    if (error) return { error: friendly(error.message) };
    clientId = c.id;
    if (l.contact_name) await supabase.from("client_contacts").insert({ client_id: c.id, name: l.contact_name, phone: l.phone, is_primary: true });
  }
  if (!clientId) return { error: "거래처를 골라 주세요." };
  const { data, error } = await supabase.from("leads").update({ client_id: clientId }).eq("id", id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "이 문의를 수정할 권한이 없습니다." };
  revalidatePath(`/leads/${id}`);
  if (s(f, "client_id") === "new") redirect(`/clients/${clientId}`);
  return { error: "", ok: "거래처에 연결했습니다." };
}

// ---------------------------------------------------------------- 예전 CRM에서 옮기기 (대표·팀장)
export async function importLegacyLeads(_p: FormState, _f: FormData): Promise<FormState> {
  const { supabase, me } = await getMe();
  if (!me) redirect("/login");
  if (me.role === "staff") return { error: "대표·팀장만 옮길 수 있습니다." };
  const { fetchLegacyLeads } = await import("@/lib/legacy-crm");
  const { data, error } = await fetchLegacyLeads();
  if (error || !data) return { error: error ?? "예전 CRM에서 읽지 못했습니다." };
  const { data: r, error: e } = await supabase.rpc("import_legacy_leads", { payload: data });
  if (e) return { error: friendly(e.message) };
  const res = r as { inserted: number; skipped: number; activities: number; created_staff: string[] };
  revalidatePath("/leads");
  revalidatePath("/leads/import");
  return {
    error: "",
    ok: `새로 옮긴 문의 ${res.inserted}건 (상담·상태 기록 ${res.activities}개), 이미 옮긴 문의 ${res.skipped}건은 건너뜀.` +
      (res.created_staff.length ? ` 퇴사 직원으로 추가: ${res.created_staff.join(", ")}` : ""),
  };
}
