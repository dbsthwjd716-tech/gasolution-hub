import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayKST } from "./billing-calc";

export type LeadRow = {
  id: string;
  inquiry_at: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  phone_digits: string | null;
  monthly_budget: number | null;
  source: string | null;
  media: string[];
  staff_id: string | null;
  staff_name: string | null;
  status: string;
  inquiry_content: string | null;
  memo: string | null;
  next_contact_on: string | null;
  last_contact_at: string | null;
  client_id: string | null;
  client_name: string | null;
  legacy_owner: string | null;
  created_by: string | null;
};

export const LEAD_COLUMNS =
  "id,inquiry_at,company_name,contact_name,phone,phone_digits,monthly_budget,source,media,staff_id,staff_name,status,inquiry_content,memo,next_contact_on,last_contact_at,client_id,client_name,legacy_owner,created_by";

// 기간(한국 날짜 YYYY-MM-DD)의 문의 — 1000건 넘게 있어도 끊기지 않게 나눠서 가져옴
export async function loadLeads(supabase: SupabaseClient, from: string, to: string) {
  const end = new Date(new Date(to + "T00:00:00+09:00").getTime() + 86400_000).toISOString();
  const rows: LeadRow[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await supabase
      .from("leads_view")
      .select(LEAD_COLUMNS)
      .gte("inquiry_at", from + "T00:00:00+09:00")
      .lt("inquiry_at", end)
      .order("inquiry_at", { ascending: false })
      .range(page * 1000, page * 1000 + 999)
      .returns<LeadRow[]>();
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}

// 기간과 상관없이 아직 진행 중인 문의 (연락 필요 확인용)
export async function loadOpenLeads(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("leads_view")
    .select(LEAD_COLUMNS)
    .in("status", ["연락 전", "연락 시도", "상담중", "제안/견적", "검토중"])
    .order("inquiry_at", { ascending: false })
    .limit(2000)
    .returns<LeadRow[]>();
  return data ?? [];
}

export async function loadDupCandidates(supabase: SupabaseClient) {
  const [{ data: leads }, { data: clients }] = await Promise.all([
    supabase.from("leads").select("id,company_name,phone_digits,inquiry_at,status").order("inquiry_at", { ascending: false }).limit(5000),
    supabase.from("clients").select("id,company_name,name_aliases(alias)").limit(5000),
  ]);
  return [
    ...(leads ?? []).map((l) => ({ ...l, kind: "lead" as const })),
    ...(clients ?? []).flatMap((c) => [
      { id: c.id, company_name: c.company_name, phone_digits: null, inquiry_at: "", status: "", kind: "client" as const },
      ...((c.name_aliases ?? []) as { alias: string }[]).map((a) => ({ id: c.id, company_name: a.alias, phone_digits: null, inquiry_at: "", status: "", kind: "client" as const })),
    ]),
  ];
}

export function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

export const today = () => todayKST();
