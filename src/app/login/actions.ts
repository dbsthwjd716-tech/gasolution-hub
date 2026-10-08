"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, VIEW_AS_COOKIE } from "@/lib/supabase/server";

export async function signIn(_prev: { error: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "이메일 또는 비밀번호가 맞지 않습니다." };
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/home");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(VIEW_AS_COOKIE); // 직원 화면 미리보기도 함께 끝냄
  redirect("/login");
}
