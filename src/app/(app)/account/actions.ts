"use server";

import { createClient } from "@/lib/supabase/server";

export async function changePassword(_p: { error: string; ok?: string }, f: FormData) {
  const pw = String(f.get("password") ?? "");
  const again = String(f.get("again") ?? "");
  if (pw.length < 8) return { error: "8자 이상으로 정해 주세요." };
  if (pw !== again) return { error: "두 칸이 서로 다릅니다." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: `바꾸지 못했습니다: ${error.message}` };
  return { error: "", ok: "비밀번호를 바꿨습니다." };
}
