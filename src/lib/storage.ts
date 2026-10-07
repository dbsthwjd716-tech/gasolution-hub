import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FILE_BUCKET } from "./supabase/browser";

// 보관함 파일을 1시간 동안 열 수 있는 링크로
export async function signedLinks(supabase: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await supabase.storage.from(FILE_BUCKET).createSignedUrls(unique, 3600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]));
}
