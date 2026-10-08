import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readRetryFetch } from "../fetch-retry";

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

export const VIEW_AS_COOKIE = "hub_view_as";

// 로그인한 직원 권한으로 동작하는 Supabase 연결 (보안 규칙이 그대로 적용됨)
// 직원 화면 미리보기 중이면 머리말에 그 직원 id를 실어 보냄 → 데이터베이스가 대표·팀장일 때만 그 직원 권한으로 바꾸고 저장은 막음
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  const viewAs = cookieStore.get(VIEW_AS_COOKIE)?.value;
  return createServerClient(url, key, {
    global: { fetch: readRetryFetch, ...(viewAs ? { headers: { "x-hub-view-as": viewAs } } : {}) },
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
  can_view_cost: boolean;
};

// 바이럴 공급가·마진을 볼 수 있나: 대표·팀장 또는 '공급가 보기'를 켠 직원
export const canViewCost = (me: Staff | null) => !!me && (me.role !== "staff" || me.can_view_cost);

export const ROLE_LABEL: Record<Staff["role"], string> = {
  ceo: "대표",
  lead: "팀장",
  staff: "직원",
};

// 지금 로그인한 사람의 직원 정보. 로그인은 했지만 직원으로 등록되지 않았으면 null
//   미리보기 중이면 me = 보고 있는 직원, viewer = 실제 로그인한 대표·팀장
export async function getMe() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, me: null, viewer: null, preview: false };
  const cols = "id,name,email,role,can_view_cost";
  const { data: real } = await supabase.from("staff").select(cols).eq("auth_user_id", user.id).eq("is_active", true).maybeSingle<Staff>();
  const viewAs = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (real && real.role !== "staff" && viewAs) {
    const { data: target } = await supabase.from("staff").select(cols).eq("id", viewAs).eq("is_active", true).eq("role", "staff").maybeSingle<Staff>();
    if (target) return { supabase, user, me: target, viewer: real, preview: true };
  }
  return { supabase, user, me: real, viewer: real, preview: false };
}
