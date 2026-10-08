import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcPay, EMPTY_AUTO, readExtras, readInputs, teamAuto, type Auto, type Extra, type Inputs, type Line, type Profile, type Tier } from "@/lib/payroll";

export type MonthRow = { month: string; team_goal: number; team_bonus: number; status: "draft" | "closed"; closed_at: string | null; memo: string | null };
export type EntryView = {
  id: string;
  staff_id: string;
  name: string;
  profile: Profile | null;
  inputs: Inputs;
  extras: Extra[];
  memo: string | null;
  auto: Auto;
  spend: number;
  lines: Line[];
  total: number;
  closed: boolean;
};

export const ymToDate = (ym: string) => `${ym}-01`;

export function currentYm() {
  const d = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
  return d.slice(0, 7);
}
export function shiftYm(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

const num = (v: unknown) => Number(v ?? 0);

export async function loadTiers(supabase: SupabaseClient): Promise<(Tier & { id: string })[]> {
  const { data } = await supabase.from("payroll_tiers").select("id,kind,min_spend,rate,rank_name,amount").order("kind").order("min_spend");
  return (data ?? []).map((t) => ({ ...t, min_spend: num(t.min_spend), rate: t.rate == null ? null : num(t.rate), amount: t.amount == null ? null : num(t.amount) }));
}

export function toProfile(p: Record<string, unknown>): Profile {
  return {
    staff_id: String(p.staff_id),
    track: p.track as Profile["track"],
    base_pay: num(p.base_pay),
    cert_allowance: num(p.cert_allowance),
    probation: !!p.probation,
    rank_allowance: !!p.rank_allowance,
    viral_in_spend: !!p.viral_in_spend,
    other_in_spend: !!p.other_in_spend,
    viral_rate: num(p.viral_rate),
    derived_rate: num(p.derived_rate),
    closing_rate: num(p.closing_rate),
    team_rate: num(p.team_rate),
    markup_rate: num(p.markup_rate),
    coupang_rate: num(p.coupang_rate),
    other_media_rate: num(p.other_media_rate),
  };
}

export async function loadProfiles(supabase: SupabaseClient) {
  const { data } = await supabase.from("payroll_profiles").select("*, staff:staff_id(name,is_active)");
  return (data ?? []).map((p) => ({ ...toProfile(p), is_active: !!p.is_active, memo: p.memo as string | null, name: (p.staff as unknown as { name: string } | null)?.name ?? "-" }));
}

// 한 달 급여: 저장된 입력값 + 바이럴 자동 집계 + 팀 값으로 계산 (마감된 달은 보관된 결과 그대로)
export async function loadPayrollMonth(supabase: SupabaseClient, ym: string) {
  const m = ymToDate(ym);
  const [{ data: month }, tiers, profiles, { data: entries }, { data: viral }] = await Promise.all([
    supabase.from("payroll_months").select("*").eq("month", m).maybeSingle<MonthRow>(),
    loadTiers(supabase),
    loadProfiles(supabase),
    supabase.from("payroll_entries").select("id,staff_id,inputs,extras,snapshot,total,memo,staff:staff_id(name)").eq("month", m),
    supabase.rpc("payroll_viral", { m }),
  ]);
  const prof = new Map(profiles.map((p) => [p.staff_id, p]));
  const vir = new Map(((viral ?? []) as { staff_id: string; own_sales: number; derived_sales: number }[]).map((v) => [v.staff_id, v]));
  const base = (entries ?? []).map((e) => ({ e, profile: prof.get(e.staff_id) ?? null, inputs: readInputs(e.inputs) }));
  const team = teamAuto(base.filter((b) => b.profile).map((b) => ({ profile: b.profile!, inputs: b.inputs, viral_sales: num(vir.get(b.e.staff_id)?.own_sales) })), num(month?.team_goal), num(month?.team_bonus));
  const closed = month?.status === "closed";

  const rows: EntryView[] = base.map(({ e, profile, inputs }) => {
    const v = vir.get(e.staff_id);
    const auto: Auto = {
      ...EMPTY_AUTO,
      viral_sales: num(v?.own_sales),
      derived_sales: num(v?.derived_sales),
      team_naver: profile?.track === "lead" ? team.teamNaver : 0,
      lead_other_spend: profile?.other_media_rate ? team.leadOther : 0,
      team_bonus: team.bonus,
    };
    const extras = readExtras(e.extras);
    const snap = e.snapshot as { spend: number; lines: Line[]; auto: Auto } | null;
    const r = closed && snap ? { spend: snap.spend, lines: snap.lines, total: num(e.total) } : profile ? calcPay(profile, inputs, auto, tiers, extras) : { spend: 0, lines: [], total: 0 };
    return {
      id: e.id,
      staff_id: e.staff_id,
      name: (e.staff as unknown as { name: string } | null)?.name ?? "-",
      profile,
      inputs,
      extras,
      memo: e.memo,
      auto: closed && snap?.auto ? snap.auto : auto,
      ...r,
      closed,
    };
  });
  const order = { lead: 0, sales_ae: 1, nonsales_ae: 2 } as const;
  rows.sort((a, b) => (a.profile ? order[a.profile.track] : 9) - (b.profile ? order[b.profile.track] : 9) || a.name.localeCompare(b.name));
  return { month, tiers, profiles, rows, team };
}
