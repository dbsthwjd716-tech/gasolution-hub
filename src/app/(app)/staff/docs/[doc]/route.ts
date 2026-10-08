import { getMe } from "@/lib/supabase/server";
import { STAFF_DOC_BUCKET } from "@/lib/staff-docs";

// 직원 서류 열기: 볼 수 있는 사람(대표·팀장·본인)인지 데이터베이스가 확인 → 열람 기록 → 1분짜리 링크로 이동
export async function GET(_: Request, ctx: RouteContext<"/staff/docs/[doc]">) {
  const { doc } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(doc)) return new Response("잘못된 주소입니다", { status: 400 });
  const { supabase, me } = await getMe();
  if (!me) return new Response("로그인이 필요합니다", { status: 401 });
  const { data: d } = await supabase.from("staff_documents").select("id,storage_path,file_name").eq("id", doc).maybeSingle();
  if (!d) return new Response("서류를 찾을 수 없거나 볼 권한이 없습니다", { status: 404 });
  await supabase.from("staff_document_views").insert({ document_id: d.id, viewed_by: me.id }); // 미리보기 중에는 기록이 막혀도 열람은 됨
  const { data: link, error } = await supabase.storage.from(STAFF_DOC_BUCKET).createSignedUrl(d.storage_path, 60);
  if (error || !link) return new Response("파일을 열지 못했습니다", { status: 500 });
  return Response.redirect(link.signedUrl, 302);
}
