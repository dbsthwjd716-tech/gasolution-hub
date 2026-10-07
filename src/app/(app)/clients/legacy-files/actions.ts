"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/supabase/server";
import { FILE_BUCKET } from "@/lib/supabase/browser";
import { LEGACY_PREFIX, legacyPaths } from "./data";

export type CopyState = { error: string; ok?: string; failed?: string[] };

export async function copyLegacyFiles(_p: CopyState, _f: FormData): Promise<CopyState> {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return { error: "대표·팀장만 할 수 있습니다." };
  const url = process.env.BILLING_SUPABASE_URL;
  const key = process.env.BILLING_SUPABASE_KEY;
  if (!url || !key) return { error: "예전 정산 시스템 연결 설정이 없습니다." };
  const list = await legacyPaths(supabase);
  let copied = 0, existed = 0;
  const failed: string[] = [];
  for (const f of list) {
    const src = f.path.slice(LEGACY_PREFIX.length);
    const bucket = src.startsWith("contracts/") || src.startsWith("templates/") ? "contract-files" : "billing-files";
    const res = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${src.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) { failed.push(`${src} (${res.status})`); continue; }
    const body = await res.arrayBuffer();
    const { error } = await supabase.storage.from(FILE_BUCKET).upload(f.path, body, { contentType: f.type ?? res.headers.get("content-type") ?? undefined, upsert: false });
    if (error) {
      if (/exists|duplicate/i.test(error.message)) existed++;
      else failed.push(`${src} (${error.message})`);
    } else copied++;
  }
  revalidatePath("/clients/legacy-files");
  return { error: failed.length ? `${failed.length}개를 옮기지 못했습니다.` : "", ok: `복사 ${copied}개 · 이미 있음 ${existed}개 (전체 ${list.length}개)`, failed };
}
