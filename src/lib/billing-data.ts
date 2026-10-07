import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarkupType, VatMode } from "./billing-calc";

export type BillingClient = {
  id: string;
  company_name: string;
  business_number: string | null;
  representative_name: string | null;
  address: string | null;
  billing_emails: string[];
  has_registration: boolean;
  status: string;
  brands: { id: string; name: string }[];
};

export type ContractTerms = {
  id: string;
  client_id: string;
  start_date: string | null;
  end_date: string | null;
  contract_date: string;
  media: string[];
  markup_type: MarkupType;
  markup_rate: number;
  markup_fixed: number;
  min_fee: number;
  vat_mode: VatMode;
};

export type Supplier = {
  code: string;
  name: string;
  representative_name: string | null;
  business_number: string | null;
  address: string | null;
  business_type: string | null;
  phone: string | null;
  email: string | null;
  bank_account: string | null;
  bank_holder: string | null;
};

export const MEDIA_LABEL: Record<string, string> = {
  naver: "네이버",
  gfa: "GFA",
  meta: "메타",
  google: "구글",
  kakao: "카카오",
  coupang: "쿠팡",
  other: "기타",
};

export async function loadBillingClients(supabase: SupabaseClient): Promise<BillingClient[]> {
  const { data } = await supabase
    .from("clients")
    .select("id,company_name,business_number,representative_name,address,billing_emails,status,brands(id,name),client_documents(document_type)")
    .order("company_name");
  return (data ?? []).map((c) => ({
    id: c.id,
    company_name: c.company_name,
    business_number: c.business_number,
    representative_name: c.representative_name,
    address: c.address,
    billing_emails: c.billing_emails ?? [],
    status: c.status,
    brands: c.brands ?? [],
    has_registration: (c.client_documents ?? []).some((d: { document_type: string }) => d.document_type === "business_registration"),
  }));
}

// 정산에 자동으로 넣을 수 있는 '계약 완료' 상태의 계약 조건
export async function loadActiveContracts(supabase: SupabaseClient): Promise<ContractTerms[]> {
  const { data } = await supabase
    .from("contracts")
    .select("id,client_id,start_date,end_date,contract_date,media,markup_type,markup_rate,markup_fixed,min_fee,vat_mode")
    .eq("status", "active")
    .order("start_date", { ascending: false, nullsFirst: false });
  return (data ?? []).map((c) => ({ ...c, markup_rate: Number(c.markup_rate), markup_fixed: Number(c.markup_fixed), min_fee: Number(c.min_fee) }));
}

export async function loadSuppliers(supabase: SupabaseClient): Promise<Supplier[]> {
  const { data } = await supabase.from("suppliers").select("*").eq("is_active", true).order("sort_order");
  return data ?? [];
}

export async function loadStaffNames(supabase: SupabaseClient) {
  const { data } = await supabase.from("staff").select("id,name,is_active").order("name");
  return data ?? [];
}
