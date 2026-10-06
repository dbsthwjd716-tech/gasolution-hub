import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 환경변수가 없습니다.",
    );
  }
  return { url, key };
}

// 로그인한 직원 권한으로 동작하는 Supabase 연결 (보안 규칙이 그대로 적용됨)
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // 화면(Server Component)에서는 쿠키를 쓸 수 없음. proxy가 세션을 갱신하므로 무시해도 됨
        }
      },
    },
  });
}

export type Staff = {
  id: string;
  name: string;
  email: string;
  role: "ceo" | "lead" | "staff";
};

export const ROLE_LABEL: Record<Staff["role"], string> = {
  ceo: "대표",
  lead: "팀장",
  staff: "직원",
};

// 지금 로그인한 사람의 직원 정보. 로그인은 했지만 직원으로 등록되지 않았으면 null
export async function getMe() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, me: null };
  const { data: me } = await supabase
    .from("staff")
    .select("id,name,email,role")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle<Staff>();
  return { supabase, user, me };
}
