import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientOption } from "./forms";
import { readTabs } from "@/lib/google-sheets";
import type { PriceRow } from "@/lib/viral-products";
import { getMe } from "@/lib/supabase/server";
import { PARTNER_TABS, planViralImport, type ImportPlan } from "@/lib/viral-import";

// 바이럴 입력 화면에서 고를 거래처 목록 (업체 정보·브랜드·다른 이름 포함)
export async function loadClientOptions(supabase: SupabaseClient): Promise<ClientOption[]> {
  const { data } = await supabase
    .from("clients")
    .select("id,company_name,business_number,representative_name,address,billing_emails,brands(id,name),name_aliases(alias),client_documents(document_type)")
    .neq("status", "ended")
    .order("company_name");
  return (data ?? []).map((c) => ({
    id: c.id,
    company_name: c.company_name,
    business_number: c.business_number,
    representative_name: c.representative_name,
    address: c.address,
    billing_emails: c.billing_emails ?? [],
    has_registration: (c.client_documents ?? []).some((d: { document_type: string }) => d.document_type === "business_registration"),
    aliases: (c.name_aliases ?? []).map((a: { alias: string }) => a.alias),
    brands: c.brands ?? [],
  }));
}

// 파생 실적자로 고를 수 있는 재직 직원
export async function loadActiveStaff(supabase: SupabaseClient) {
  const { data } = await supabase.from("staff").select("id,name").eq("is_active", true).order("name");
  return data ?? [];
}

// 협력사 단가표 (입력 화면 자동 계산용)
export async function loadPrices(supabase: SupabaseClient): Promise<PriceRow[]> {
  const [{ data }, { data: costs }] = await Promise.all([
    supabase.from("viral_price_list").select("id,partner_id,product_type,platform,product_name,days,unit_label,sale_price").eq("is_active", true),
    // 공급가는 권한 있는 사람에게만 (권한 없으면 빈 결과)
    supabase.rpc("viral_price_costs"),
  ]);
  const cost = new Map(((costs ?? []) as { id: string; cost_price: number }[]).map((c) => [c.id, Number(c.cost_price)]));
  return (data ?? []).map((p) => ({ ...p, cost_price: cost.get(p.id) ?? null, sale_price: Number(p.sale_price) }));
}

export async function loadPartners(supabase: SupabaseClient) {
  const { data } = await supabase.from("viral_partners").select("id,name").eq("is_active", true).order("name");
  return data ?? [];
}

// 시트를 읽어 옮기기 계획을 만든다 (화면 미리보기·옮기기에서만 사용, 외부에서 직접 호출 불가)
export async function loadSheetPlan(): Promise<ImportPlan> {
  const { supabase, me } = await getMe();
  if (!me || (me.role !== "ceo" && me.role !== "lead")) throw new Error("대표·팀장만 시트를 읽을 수 있습니다.");
  const sheetId = process.env.VIRAL_GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("VIRAL_GOOGLE_SHEET_ID 환경변수가 없습니다.");
  const { data: staff } = await supabase.from("staff").select("name");
  const tabs = await readTabs(sheetId, PARTNER_TABS);
  return planViralImport(tabs, { managers: (staff ?? []).map((x) => x.name) });
}


// 한국 시간 기준 이번 달 (YYYY-MM)
export function currentMonthKST(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
}
