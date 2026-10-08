"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/supabase/server";

export type FormState = { error: string; ok?: string; password?: string };

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

async function manager() {
  const r = await getMe();
  if (!r.me || r.me.role === "staff") throw new Error("대표·팀장만 할 수 있습니다.");
  return r;
}

const friendly = (m: string) =>
  m.includes("duplicate") ? "이미 등록된 이메일입니다." : m.includes("row-level") || m.includes("대표만") ? "이 변경은 대표만 할 수 있습니다." : `저장하지 못했습니다: ${m}`;

// 직원 추가 (팀장은 일반 직원만, 대표는 역할 선택)
export async function addStaff(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase, me } = await manager();
  const name = s(f, "name");
  const email = s(f, "email").toLowerCase();
  const role = me!.role === "ceo" && ["ceo", "lead", "staff"].includes(s(f, "role")) ? s(f, "role") : "staff";
  if (!name) return { error: "이름을 입력해 주세요." };
  if (!isEmail(email)) return { error: "이메일 형식을 확인해 주세요. (로그인 아이디로 씁니다)" };
  const { data, error } = await supabase.from("staff").insert({ name, email, role }).select("id").single();
  if (error) return { error: friendly(error.message) };
  const join = s(f, "join_date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(join)) await supabase.from("staff_hr").upsert({ staff_id: data.id, join_date: join });
  revalidatePath("/staff");
  return { error: "", ok: `${name}님을 등록했습니다. 이제 「로그인 계정 만들기」를 눌러 주세요.` };
}

// 퇴사 처리 / 복직
export async function setActive(id: string, active: boolean) {
  const { supabase } = await manager();
  await supabase.from("staff").update({ is_active: active }).eq("id", id);
  revalidatePath("/staff");
}

// 입사일 저장
export async function saveJoinDate(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await manager();
  const join = s(f, "join_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(join)) return { error: "날짜를 확인해 주세요." };
  const { error } = await supabase.from("staff_hr").upsert({ staff_id: id, join_date: join });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/staff");
  return { error: "", ok: "저장" };
}

// 로그인 계정 만들기 / 비밀번호 초기화: 데이터베이스에서 바로 만들고 임시 비밀번호를 한 번만 보여 줌
//   대표는 누구나, 팀장은 일반 직원만 (데이터베이스 규칙). 직원은 첫 로그인 후 「비밀번호」에서 바꿈
export async function createLogin(id: string, _p: FormState, _f: FormData): Promise<FormState> {
  const { supabase } = await manager();
  const { data: st } = await supabase.from("staff").select("name,email").eq("id", id).maybeSingle();
  const { data, error } = await supabase.rpc("staff_create_login", { p_staff: id });
  if (error) return { error: error.message };
  revalidatePath("/staff");
  return { error: "", ok: `${st?.name ?? ""}님 로그인 계정을 만들었습니다. 아이디 ${st?.email ?? ""}`, password: String(data) };
}

export async function resetPassword(id: string, _p: FormState, _f: FormData): Promise<FormState> {
  const { supabase } = await manager();
  const { data: st } = await supabase.from("staff").select("name,email").eq("id", id).maybeSingle();
  const { data, error } = await supabase.rpc("staff_reset_password", { p_staff: id });
  if (error) return { error: error.message };
  return { error: "", ok: `${st?.name ?? ""}님 비밀번호를 초기화했습니다. 아이디 ${st?.email ?? ""}`, password: String(data) };
}
