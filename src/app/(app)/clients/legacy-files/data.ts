import "server-only";
import type { getMe } from "@/lib/supabase/server";

// 예전 정산·계약(gasolution-billing)에서 옮긴 기록의 파일을 통합 시스템 보관함으로 복사 (일회성)
//   통합 시스템에는 'legacy-billing/<예전 경로>'로 기록돼 있고, 같은 경로로 파일을 가져와 넣음
export const LEGACY_PREFIX = "legacy-billing/";
const TEMPLATE = "legacy-billing/templates/GA_Solution_Contract_Master_Template.docx";

export async function legacyPaths(supabase: Awaited<ReturnType<typeof getMe>>["supabase"]) {
  const [{ data: docs }, { data: files }, { data: contracts }] = await Promise.all([
    supabase.from("client_documents").select("storage_path,mime_type").like("storage_path", `${LEGACY_PREFIX}%`),
    supabase.from("billing_files").select("storage_path,mime_type").like("storage_path", `${LEGACY_PREFIX}%`),
    supabase.from("contracts").select("signed_file_path").like("signed_file_path", `${LEGACY_PREFIX}%`),
  ]);
  const list = [
    ...(docs ?? []).map((d) => ({ path: d.storage_path as string, type: d.mime_type as string | null })),
    ...(files ?? []).map((d) => ({ path: d.storage_path as string, type: d.mime_type as string | null })),
    ...(contracts ?? []).map((d) => ({ path: d.signed_file_path as string, type: "application/pdf" })),
    { path: TEMPLATE, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ];
  return [...new Map(list.map((x) => [x.path, x])).values()];
}

