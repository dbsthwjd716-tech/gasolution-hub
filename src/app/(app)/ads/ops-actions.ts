"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";

export type OpsForm = { error: string; ok?: string };
const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v.length ? v : null;
};
const touch = () => {
  revalidatePath("/ads/today");
  revalidatePath("/ads/routines");
  revalidatePath("/home");
};

// 루틴·약속 등록 (직원은 본인 것, 대표·팀장은 담당 지정 가능)
export async function addRoutine(_p: OpsForm, f: FormData): Promise<OpsForm> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const title = s(f, "title");
  if (!title) return { error: "할 일을 적어 주세요. (예: 주간 보고서 발송)" };
  const kind = s(f, "kind") ?? "weekly";
  if (!["daily", "weekly", "monthly", "once"].includes(kind)) return { error: "주기를 골라 주세요." };
  const weekdays = f.getAll("weekdays").map(Number).filter((x) => x >= 1 && x <= 7);
  const monthDay = Number(s(f, "month_day") ?? 0);
  const due = s(f, "due_date");
  if (kind === "weekly" && !weekdays.length) return { error: "요일을 하나 이상 골라 주세요." };
  if (kind === "monthly" && !(monthDay >= 1 && monthDay <= 31)) return { error: "매월 날짜를 골라 주세요." };
  if (kind === "once" && !due) return { error: "약속 날짜를 골라 주세요." };
  const staffId = me.role !== "staff" && s(f, "staff_id") ? s(f, "staff_id") : me.id;
  const { error } = await supabase.from("ops_routines").insert({
    title,
    advertiser_name: s(f, "advertiser_name"),
    staff_id: staffId,
    kind,
    weekdays: kind === "weekly" ? weekdays : [],
    month_day: kind === "monthly" ? monthDay : null,
    due_date: kind === "once" ? due : null,
    due_time: s(f, "due_time"),
    memo: s(f, "memo"),
    start_date: kind === "once" && due && due < todayKST() ? due : todayKST(),
  });
  if (error) return { error: `저장하지 못했습니다: ${error.message}` };
  touch();
  return { error: "", ok: `「${title}」 등록했습니다.` };
}

export async function checkRoutine(id: string, date: string) {
  const { supabase } = await getMe();
  await supabase.from("ops_routine_checks").upsert({ routine_id: id, due_date: date });
  touch();
}

export async function uncheckRoutine(id: string, date: string) {
  const { supabase } = await getMe();
  await supabase.from("ops_routine_checks").delete().eq("routine_id", id).eq("due_date", date);
  touch();
}

export async function setRoutineActive(id: string, active: boolean) {
  const { supabase } = await getMe();
  await supabase.from("ops_routines").update({ is_active: active }).eq("id", id);
  touch();
}

export async function removeRoutine(id: string) {
  const { supabase } = await getMe();
  await supabase.from("ops_routines").delete().eq("id", id);
  touch();
}

// 인입 문의 재연락: 상담 기록을 남기면 오늘 할 일에서 빠짐 (다음 연락일을 정하면 그날 다시 보임)
export async function logLeadContact(leadId: string, _p: OpsForm, f: FormData): Promise<OpsForm> {
  const { supabase, me } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  const type = s(f, "type") ?? "전화";
  if (!["전화", "문자", "카카오톡", "이메일", "미팅", "기타"].includes(type)) return { error: "연락 방법을 골라 주세요." };
  const content = s(f, "content") ?? `${type}로 다시 연락 시도`;
  const { error } = await supabase.from("lead_activities").insert({ lead_id: leadId, activity_type: type, content });
  if (error) return { error: `기록하지 못했습니다: ${error.message}` };
  const next = s(f, "next_contact_on");
  await supabase.from("leads").update({ next_contact_on: next && /^\d{4}-\d{2}-\d{2}$/.test(next) ? next : null }).eq("id", leadId);
  touch();
  revalidatePath(`/leads/${leadId}`);
  return { error: "", ok: "기록했습니다." };
}

// 루틴·약속 여러 건 한꺼번에 완료 (값: 루틴id|해야 하는 날짜)
export async function completeRoutines(formData: FormData) {
  const { supabase } = await getMe();
  const rows = [...new Set(formData.getAll("key").map(String))]
    .map((k) => k.split("|"))
    .filter(([id, d]) => id && /^\d{4}-\d{2}-\d{2}$/.test(d ?? ""))
    .slice(0, 300)
    .map(([routine_id, due_date]) => ({ routine_id, due_date }));
  if (rows.length) await supabase.from("ops_routine_checks").upsert(rows, { onConflict: "routine_id,due_date", ignoreDuplicates: true });
  touch();
}
