"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMe, VIEW_AS_COOKIE } from "@/lib/supabase/server";

// 대표·팀장: 일반 직원 화면으로 보기 시작 / 끝내기
export async function startPreview(formData: FormData) {
  const id = String(formData.get("staff_id") ?? "");
  const { viewer, supabase } = await getMe();
  if (!viewer || viewer.role === "staff" || !id) return;
  const { data } = await supabase.from("staff").select("id").eq("id", id).eq("is_active", true).eq("role", "staff").maybeSingle();
  if (!data) return;
  (await cookies()).set(VIEW_AS_COOKIE, id, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
  redirect("/home");
}

export async function stopPreview() {
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/home");
}
