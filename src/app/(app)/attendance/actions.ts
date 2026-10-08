"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/supabase/server";
import { kstStamp } from "@/lib/attendance";
import { fetchLegacyAttendance } from "@/lib/legacy-attendance";

export type FormState = { error: string; ok?: string };

const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v.length ? v : null;
};
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function friendly(message: string) {
  if (message.includes("row-level security")) return "권한이 없습니다.";
  if (message.includes("permission denied")) return "권한이 없습니다.";
  if (message.includes("duplicate key") && message.includes("company_holidays")) return "그날은 이미 휴일로 등록되어 있습니다.";
  return message.replace(/^.*?ERROR:\s*/, "");
}

async function client() {
  const { supabase, me } = await getMe();
  if (!me) redirect("/login");
  return { supabase, me };
}

function done(ok: string): FormState {
  revalidatePath("/", "layout"); // 오른쪽 위 퇴근하기 버튼까지 모든 화면 새로 그림
  revalidatePath("/home");
  return { error: "", ok };
}

// 버튼 하나로 끝나는 처리 (출근·퇴근·승인·반려·거둬들이기 등). 실제 권한은 데이터베이스가 다시 확인함
const OPS: Record<string, { rpc: string; args: (f: FormData) => Record<string, unknown>; ok: string }> = {
  clock_in: { rpc: "clock_in", args: () => ({}), ok: "출근했습니다." },
  clock_out: { rpc: "clock_out", args: () => ({}), ok: "퇴근했습니다." },
  leave_first: { rpc: "leave_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "first", p_deduct: deduct(f) }), ok: "1차 승인했습니다." },
  leave_final: { rpc: "leave_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "final", p_deduct: deduct(f) }), ok: "최종 승인했습니다." },
  leave_reject: { rpc: "leave_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "reject", p_note: s(f, "note") }), ok: "반려했습니다." },
  leave_withdraw: { rpc: "leave_withdraw", args: (f) => ({ p_id: Number(s(f, "id")) }), ok: "신청을 거둬들였습니다." },
  cancel_first: { rpc: "leave_cancel_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "first" }), ok: "취소 요청을 1차 승인했습니다." },
  cancel_final: { rpc: "leave_cancel_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "final" }), ok: "휴가를 취소했습니다. 연차가 돌아왔습니다." },
  cancel_reject: { rpc: "leave_cancel_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "reject" }), ok: "취소 요청을 반려했습니다. 휴가는 그대로입니다." },
  exc_approve: { rpc: "attendance_exception_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "approve" }), ok: "승인했습니다." },
  exc_reject: { rpc: "attendance_exception_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "reject" }), ok: "반려했습니다." },
  exc_cancel: { rpc: "attendance_exception_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "cancel" }), ok: "승인을 취소했습니다." },
  exc_withdraw: { rpc: "attendance_exception_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "withdraw" }), ok: "신청을 거둬들였습니다." },
  corr_approve: { rpc: "attendance_correction_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "approved", p_note: s(f, "note") }), ok: "수정 요청을 승인했습니다." },
  corr_reject: { rpc: "attendance_correction_decide", args: (f) => ({ p_id: Number(s(f, "id")), p_action: "rejected", p_note: s(f, "note") }), ok: "수정 요청을 반려했습니다." },
};

function deduct(f: FormData) {
  const v = s(f, "deduct");
  return v === "yes" ? true : v === "no" ? false : null;
}

export async function act(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await client();
  const op = OPS[String(f.get("op") ?? "")];
  if (!op) return { error: "알 수 없는 처리입니다." };
  const { error } = await supabase.rpc(op.rpc, op.args(f));
  if (error) return { error: friendly(error.message) };
  return done(op.ok);
}

// 휴가 신청 (대표·팀장은 다른 직원 것도 대신 넣을 수 있음)
export async function requestLeave(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await client();
  const leave_type = s(f, "leave_type");
  const start = s(f, "start_date");
  const half = leave_type === "morning_half" || leave_type === "afternoon_half";
  const end = half ? start : s(f, "end_date") ?? start;
  if (!leave_type) return { error: "휴가 종류를 골라 주세요." };
  if (!isDate(start) || !isDate(end)) return { error: "날짜를 골라 주세요." };
  const why = s(f, "reason");
  const handover = s(f, "handover");
  const reason = [why && `사유: ${why}`, handover && `인수인계: ${handover}`].filter(Boolean).join("\n") || null;
  const { error } = await supabase.from("leave_requests").insert({
    staff_id: s(f, "staff_id") ?? me.id,
    leave_type,
    start_date: start,
    end_date: end,
    reason,
    resubmitted_from_id: s(f, "resubmitted_from_id") ? Number(s(f, "resubmitted_from_id")) : null,
  });
  if (error) return { error: friendly(error.message) };
  return done("신청했습니다. 대표·팀장의 1차·최종 승인 후 확정됩니다.");
}

export async function requestLeaveCancel(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await client();
  const { error } = await supabase.rpc("leave_cancel_request", { p_id: Number(s(f, "id")), p_reason: s(f, "reason") });
  if (error) return { error: friendly(error.message) };
  return done("취소 요청을 보냈습니다. 최종 승인 전까지 휴가는 그대로 유지됩니다.");
}

export async function requestException(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await client();
  const type = s(f, "exception_type");
  const date = s(f, "work_date");
  if (!type) return { error: "종류를 골라 주세요." };
  if (!isDate(date)) return { error: "날짜를 골라 주세요." };
  const timed = type === "meeting" || type === "direct_home" || type === "other";
  const { error } = await supabase.from("attendance_exceptions").insert({
    staff_id: s(f, "staff_id") ?? me.id,
    work_date: date,
    exception_type: type,
    start_time: timed ? s(f, "start_time") : null,
    end_time: timed ? s(f, "end_time") : null,
    approved_leave_time: type === "promotion_early_leave" ? s(f, "approved_leave_time") : null,
    location: type === "meeting" || type === "direct_home" ? s(f, "location") : null,
    note: s(f, "note"),
  });
  if (error) return { error: friendly(error.message) };
  return done("신청했습니다. 승인되면 달력에 표시됩니다.");
}

export async function requestCorrection(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await client();
  const date = s(f, "work_date");
  if (!isDate(date)) return { error: "날짜 정보가 없습니다." };
  try {
    const { error } = await supabase.rpc("attendance_correction_request", {
      p_record: Number(s(f, "id")),
      p_in: kstStamp(date, s(f, "clock_in")),
      p_out: kstStamp(date, s(f, "clock_out")),
      p_reason: s(f, "reason"),
    });
    if (error) return { error: friendly(error.message) };
  } catch (e) {
    return { error: (e as Error).message };
  }
  return done("수정 요청을 보냈습니다.");
}

// 대표·팀장: 근태 기록 직접 고치기 (없는 날은 새로 만듦)
export async function saveRecord(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await client();
  const date = s(f, "work_date");
  if (!isDate(date)) return { error: "날짜를 골라 주세요." };
  try {
    const { error } = await supabase.rpc("attendance_record_save", {
      p_staff: s(f, "staff_id"),
      p_date: date,
      p_in: kstStamp(date, s(f, "clock_in")),
      p_out: kstStamp(date, s(f, "clock_out")),
      p_note: s(f, "note"),
      p_reason: s(f, "reason"),
    });
    if (error) return { error: friendly(error.message) };
  } catch (e) {
    return { error: (e as Error).message };
  }
  return done("근태 기록을 고쳤습니다.");
}

export async function setBalance(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await client();
  const num = (k: string) => Number(String(f.get(k) ?? "").replace(/[^\d.-]/g, "") || 0);
  const { error } = await supabase.rpc("leave_balance_set", {
    p_staff: s(f, "staff_id"),
    p_year: Number(s(f, "year")),
    p_granted: num("granted"),
    p_adjust: num("adjustment"),
    p_note: s(f, "note"),
  });
  if (error) return { error: friendly(error.message) };
  return done("연차를 저장했습니다.");
}

export async function saveSettings(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await client();
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("set:")) continue;
    const { error } = await supabase.rpc("work_setting_set", { p_key: k.slice(4), p_value: String(v) });
    if (error) return { error: friendly(error.message) };
  }
  return done("근무 설정을 저장했습니다.");
}

export async function addHoliday(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await client();
  const date = s(f, "holiday_date");
  const name = s(f, "holiday_name");
  if (!isDate(date) || !name) return { error: "날짜와 이름을 입력해 주세요." };
  const { error } = await supabase.from("company_holidays").insert({ holiday_date: date, holiday_name: name });
  if (error) return { error: friendly(error.message) };
  return done("휴일을 추가했습니다.");
}

export async function removeHoliday(date: string) {
  const { supabase } = await client();
  await supabase.from("company_holidays").delete().eq("holiday_date", date);
  revalidatePath("/attendance", "layout");
}

export async function saveHr(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await client();
  const staff_id = s(f, "staff_id");
  if (!staff_id) return { error: "직원 정보가 없습니다." };
  const int = (k: string) => (s(f, k) ? Number(s(f, k)) : null);
  const { error } = await supabase.from("staff_hr").upsert({
    staff_id,
    join_date: s(f, "join_date"),
    birthday_month: int("birthday_month"),
    birthday_day: int("birthday_day"),
    work_type: s(f, "work_type") ?? "standard",
    leave_grant_mode: s(f, "leave_grant_mode") ?? "accounting_auto",
    work_phone: s(f, "work_phone"),
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: friendly(error.message) };
  return done("인사 정보를 저장했습니다.");
}

export async function importLegacyAttendance(_p: FormState, _f: FormData): Promise<FormState> {
  const { supabase, me } = await client();
  if (me.role === "staff") return { error: "대표·팀장만 옮길 수 있습니다." };
  const { data, error } = await fetchLegacyAttendance();
  if (!data) return { error: error ?? "읽지 못했습니다." };
  const { data: r, error: e } = await supabase.rpc("import_legacy_attendance", { payload: data });
  if (e) return { error: friendly(e.message) };
  const x = r as { leaves: number; exceptions: number; records: number; skipped_records: number; corrections: number; created_staff: string[] };
  const parts = [`출퇴근 기록 ${x.records}건`, `휴가 신청 ${x.leaves}건`, `근태 예외 ${x.exceptions}건`, `수정 요청 ${x.corrections}건`];
  if (x.skipped_records) parts.push(`같은 날 통합 시스템 기록이 있어 건너뛴 ${x.skipped_records}건`);
  if (x.created_staff.length) parts.push(`퇴사 직원으로 새로 등록: ${x.created_staff.join(", ")}`);
  return done("옮겼습니다 · " + parts.join(" · "));
}
