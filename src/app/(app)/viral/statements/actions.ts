"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canViewCost, getMe } from "@/lib/supabase/server";
import { parseUploaded } from "@/lib/uploads";
import { FILE_BUCKET } from "@/lib/supabase/browser";

export type FormState = { error: string; ok?: string };
const STATEMENT_FOLDER = "viral/statements"; // 화면(forms.tsx)의 업로드 폴더와 같아야 함

const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v.length ? v : null;
};
const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function friendly(message: string) {
  if (message.includes("row-level security") || message.includes("권한")) return "권한이 없습니다. 대표·팀장·공급가 보기 권한이 있는 사람만 다룰 수 있습니다.";
  if (message.includes("입금을 먼저")) return message;
  return "저장하지 못했습니다: " + message;
}

async function guard() {
  const { supabase, me } = await getMe();
  if (!me) redirect("/login");
  if (!canViewCost(me)) throw new Error("권한이 없습니다");
  return { supabase, me };
}

function read(f: FormData) {
  const amount = Number(String(f.get("amount") ?? "").replace(/[^\d]/g, "") || 0);
  return {
    partner_id: s(f, "partner_id"),
    period_start: s(f, "period_start"),
    period_end: s(f, "period_end"),
    title: s(f, "title"),
    amount,
    memo: s(f, "memo"),
  };
}

function check(v: ReturnType<typeof read>) {
  if (!v.partner_id) return "협력사를 골라 주세요.";
  if (!isDate(v.period_start) || !isDate(v.period_end)) return "기간(시작일·끝나는 날)을 입력해 주세요.";
  if (v.period_end! < v.period_start!) return "끝나는 날이 시작일보다 빠릅니다.";
  return "";
}

async function saveFiles(supabase: Awaited<ReturnType<typeof getMe>>["supabase"], statementId: string, f: FormData) {
  const files = parseUploaded(f.get("files"), STATEMENT_FOLDER);
  if (!files.length) return null;
  const { error } = await supabase.from("viral_partner_statement_files").insert(
    files.map((x) => ({ statement_id: statementId, file_name: x.name, storage_path: x.path, mime_type: x.type, file_size: x.size })),
  );
  return error;
}

export async function createStatement(_p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await guard();
  const v = read(f);
  const err = check(v);
  if (err) return { error: err };
  const { data, error } = await supabase.from("viral_partner_statements").insert(v).select("id").single();
  if (error || !data) return { error: friendly(error?.message ?? "") };
  const fe = await saveFiles(supabase, data.id, f);
  if (fe) return { error: "견적서는 저장했지만 파일을 연결하지 못했습니다: " + fe.message };
  revalidatePath("/viral/statements");
  redirect(`/viral/statements/${data.id}`);
}

export async function updateStatement(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await guard();
  const v = read(f);
  const err = check(v);
  if (err) return { error: err };
  const { error } = await supabase
    .from("viral_partner_statements")
    .update({ ...v, paid_on: s(f, "paid_on"), invoice_done_on: s(f, "invoice_done_on") })
    .eq("id", id);
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/viral/statements/${id}`);
  revalidatePath("/viral/statements");
  return { error: "", ok: "저장했습니다." };
}

// 목록·상세에서 바로 체크: 협력사 입금 / 광고주 세금계산서 발행
export async function setStatementFlag(id: string, field: "paid" | "invoice_done", value: boolean) {
  const { supabase } = await guard();
  const patch = field === "paid" ? { paid: value, ...(value ? {} : { invoice_done: false }) } : { invoice_done: value };
  await supabase.from("viral_partner_statements").update(patch).eq("id", id);
  revalidatePath("/viral/statements");
  revalidatePath(`/viral/statements/${id}`);
  revalidatePath("/viral");
}

export async function addStatementFiles(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await guard();
  const fe = await saveFiles(supabase, id, f);
  if (fe) return { error: friendly(fe.message) };
  revalidatePath(`/viral/statements/${id}`);
  revalidatePath("/viral/statements");
  return { error: "", ok: "파일을 올렸습니다." };
}

export async function deleteStatementFile(id: string, fileId: string) {
  const { supabase } = await guard();
  const { data } = await supabase.from("viral_partner_statement_files").delete().eq("id", fileId).select("storage_path");
  const paths = (data ?? []).map((d) => d.storage_path);
  if (paths.length) await supabase.storage.from(FILE_BUCKET).remove(paths);
  revalidatePath(`/viral/statements/${id}`);
}

export async function deleteStatement(id: string) {
  const { supabase } = await guard();
  await supabase.from("viral_partner_statements").delete().eq("id", id);
  revalidatePath("/viral/statements");
  redirect("/viral/statements");
}

// 이 견적서에 들어 있는 바이럴 건 고르기 (체크한 건만 연결, 나머지는 연결 해제)
export async function linkOrders(id: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await guard();
  const ids = f.getAll("order_id").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const { data, error } = await supabase.rpc("viral_statement_link", { sid: id, order_ids: ids });
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/viral/statements/${id}`);
  revalidatePath("/viral/statements");
  revalidatePath("/viral");
  return { error: "", ok: `${data ?? ids.length}건을 연결했습니다.` };
}
