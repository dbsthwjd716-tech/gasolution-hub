import { createBrowserClient } from "@supabase/ssr";

// 브라우저에서 바로 파일을 올릴 때만 사용 (로그인 쿠키를 그대로 씀, 보안 규칙 동일 적용)
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

export const FILE_BUCKET = "hub-files";
