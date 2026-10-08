import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 모든 화면 요청 전에 로그인 세션을 갱신하고, 로그인 안 했으면 로그인 화면으로 보냄
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLogin = request.nextUrl.pathname.startsWith("/login");
  if (!user && !isLogin) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    return NextResponse.redirect(to);
  }
  if (user && isLogin) {
    const to = request.nextUrl.clone();
    to.pathname = "/home";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  // /api/ads/jobs: 데이터베이스 예약 작업이 부르는 수집 주소 (로그인 대신 수집기 열쇠로 확인)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/ads/jobs|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
