"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/supabase/server";
import { parseUploaded } from "@/lib/uploads";
import { isDocKind, STAFF_DOC_BUCKET } from "@/lib/staff-docs";

export type DocState = { error: string; ok?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function refresh(staffId: string) {
  revalidatePath(`/staff/${staffId}`);
  revalidatePath("/staff");
  revalidatePath("/account");
}

// 서류 올리기: 파일은 화면에서 보관함(staff-docs/직원id/…)에 먼저 올라가고, 여기서 목록에 등록
//   대표·팀장은 누구 것이든, 직원은 본인 것만 (데이터베이스 규칙이 막음)
export async function addStaffDocs(staffId: string, _p: DocState, f: FormData): Promise<DocState> {
  const { supabase, me } = await getMe();
  if (!me || !UUID.test(staffId)) return { error: "로그인이 필요합니다." };
  if (me.role === "staff" && me.id !== staffId) return { error: "본인 서류만 올릴 수 있습니다." };
  const kind = t(f, "kind");
  if (!isDocKind(kind)) return { error: "서류 종류를 골라 주세요." };
  const files = parseUploaded(f.get("files"), staffId);
  if (!files.length) return { error: "파일을 먼저 올려 주세요." };
  const issued = t(f, "issued_on");
  const rows = files.map((x) => ({
    staff_id: staffId,
    kind,
    title: t(f, "title") || null,
    issued_on: /^\d{4}-\d{2}-\d{2}$/.test(issued) ? issued : null,
    storage_path: x.path,
    file_name: x.name,
    mime_type: x.type || null,
    file_size: x.size || null,
    note: t(f, "note") || null,
    uploaded_by: me.id,
  }));
  const { error } = await supabase.from("staff_documents").insert(rows);
  if (error) {
    await supabase.storage.from(STAFF_DOC_BUCKET).remove(files.map((x) => x.path));
    return { error: error.message.includes("row-level") ? "이 직원의 서류를 올릴 권한이 없습니다." : `저장하지 못했습니다: ${error.message}` };
  }
  refresh(staffId);
  return { error: "", ok: `${files.length}개 파일을 등록했습니다.` };
}

// 서류 지우기: 대표·팀장만 (목록과 보관함 파일 모두)
export async function removeStaffDoc(docId: string) {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff" || !UUID.test(docId)) return;
  const { data } = await supabase.from("staff_documents").delete().eq("id", docId).select("staff_id,storage_path");
  const row = data?.[0];
  if (!row) return;
  await supabase.storage.from(STAFF_DOC_BUCKET).remove([row.storage_path]);
  refresh(row.staff_id);
}
