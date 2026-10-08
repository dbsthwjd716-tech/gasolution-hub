"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/supabase/server";
import { fetchPerfSpend } from "@/lib/ads-legacy";
import type { PromoMember } from "@/lib/monthly-promo";

export type SaveState = { error: string; ok?: string };
export type MonthInput = { month: string; teamTarget: number | null; teamKind: "sum" | "manual" | null; closed: boolean; memo: string; members: PromoMember[] };

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const money = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function friendly(m: string) {
  if (m.includes("row-level security") || m.includes("permission") || m.includes("42501")) return "대표·팀장만 저장할 수 있습니다.";
  if (m.includes("미리보기")) return m.replace(/^.*?ERROR:\s*/, "");
  return m.replace(/^.*?ERROR:\s*/, "");
}

async function manager() {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return null;
  return supabase;
}

// 한 달 저장: 달 → 팀원(빠짐없이 모든 칸을 채워 보냄) → 목록에서 빠진 팀원 지우기
export async function saveMonth(input: MonthInput, isNew: boolean): Promise<SaveState> {
  const supabase = await manager();
  if (!supabase) return { error: "대표·팀장만 저장할 수 있습니다." };
  if (!YM.test(input.month)) return { error: "마감 월을 골라 주세요." };
  const members = input.members.map((m) => ({ ...m, name: m.name.trim() })).filter((m) => m.name);
  const names = members.map((m) => m.name);
  if (new Set(names).size !== names.length) return { error: "같은 이름이 두 번 들어가 있습니다." };
  const month = `${input.month}-01`;
  if (isNew) {
    const { data: exists } = await supabase.from("monthly_promo_months").select("month").eq("month", month).maybeSingle();
    if (exists) return { error: `${Number(input.month.slice(5))}월은 이미 있습니다. 위 탭에서 골라 수정해 주세요.` };
  }
  const { data: staff } = await supabase.from("staff").select("id,name");
  const sid = new Map((staff ?? []).map((s) => [s.name, s.id]));

  const { error: me1 } = await supabase.from("monthly_promo_months").upsert({
    month, team_target: money(input.teamTarget), team_kind: input.teamKind, closed: !!input.closed, memo: input.memo.trim() || null, updated_at: new Date().toISOString(),
  });
  if (me1) return { error: friendly(me1.message) };
  if (members.length) {
    const rows = members.map((m, i) => ({
      month, name: m.name, staff_id: sid.get(m.name) ?? null,
      target: money(m.target), target_kind: m.target == null ? null : (m.targetKind ?? "manual"),
      actual: money(m.actual), in_team: !m.leader && !!m.inTeam, team_amount: money(m.teamAmount),
      is_leader: !!m.leader, excluded: !!m.excluded, note: m.note?.trim() || null, sort_order: i,
    }));
    const { error: me2 } = await supabase.from("monthly_promo_members").upsert(rows, { onConflict: "month,name" });
    if (me2) return { error: friendly(me2.message) };
  }
  const { data: had } = await supabase.from("monthly_promo_members").select("name").eq("month", month);
  const gone = (had ?? []).map((h) => h.name).filter((n) => !names.includes(n));
  if (gone.length) {
    const { error: me3 } = await supabase.from("monthly_promo_members").delete().eq("month", month).in("name", gone);
    if (me3) return { error: friendly(me3.message) };
  }
  revalidatePath("/promotions/monthly");
  return { error: "", ok: "저장했습니다." };
}

export async function deleteMonth(ym: string): Promise<SaveState> {
  const supabase = await manager();
  if (!supabase || !YM.test(ym)) return { error: "대표·팀장만 지울 수 있습니다." };
  const { error } = await supabase.from("monthly_promo_months").delete().eq("month", `${ym}-01`);
  if (error) return { error: friendly(error.message) };
  revalidatePath("/promotions/monthly");
  return { error: "", ok: "삭제했습니다." };
}

export async function saveConfig(_p: SaveState, f: FormData): Promise<SaveState> {
  const supabase = await manager();
  if (!supabase) return { error: "대표·팀장만 바꿀 수 있습니다." };
  const n = (k: string) => money(String(f.get(k) ?? "").replace(/[^\d]/g, ""));
  const band = n("band_size"), trunc = n("trunc_unit");
  if (!band || !trunc) return { error: "상승 구간 단위와 절삭 단위는 0보다 커야 합니다." };
  const { error } = await supabase.from("monthly_promo_config").update({
    band_size: band, band_reward: n("band_reward") ?? 0, team_reward: n("team_reward") ?? 0,
    goal_step: n("goal_step") ?? 0, trunc_unit: trunc, partial: f.get("partial") === "on", updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) return { error: friendly(error.message) };
  revalidatePath("/promotions/monthly");
  return { error: "", ok: "기준을 저장했습니다." };
}

// 광고비 실적에서 그 달 마감액 불러오기 (저장 전 입력칸만 채움) — 급여 설정과 같은 기준 (팀장 팀 수당의 '팀원 총 광고 취급고'와 같음)
//   서진원(영업 AE) = 본인 네이버(인계건 미포함) + 메타 ÷ 1.1
//   박규진(비영업 AE, 바이럴을 마감에 합산) = 네이버 + 메타 ÷ 1.1 + 바이럴 판매가
//   박영서(매니저, 바이럴 인센티브 별도) = 네이버 + 메타 ÷ 1.1
//   팀장 = 네이버 (카카오는 대시보드에 없어 직접 더함)
//   팀 목표 판정(팀 산정액)은 엑셀처럼 모두 네이버 + 메타 → 바이럴을 넣는 사람은 팀 산정액에 네이버 + 메타를 따로 넣음
export type SpendFill = { name: string; actual: number; teamAmount: number | null; basis: string }[];
export async function loadSpend(ym: string): Promise<{ rows?: SpendFill; through?: string | null; error?: string }> {
  const supabase = await manager();
  if (!supabase || !YM.test(ym)) return { error: "대표·팀장만 불러올 수 있습니다." };
  const [y, m] = ym.split("-").map(Number);
  const from = `${ym}-01`;
  const last = `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  const [perf, { data: viral }, { data: profiles }, { data: staff }] = await Promise.all([
    fetchPerfSpend(from, last),
    supabase.rpc("payroll_viral", { m: from }), // 급여와 같은 바이럴: 입금일 기준, 인센티브 제외 상품 뺌
    supabase.from("payroll_profiles").select("track, viral_in_spend, staff:staff_id(name)"),
    supabase.from("staff").select("id,name"),
  ]);
  if (!perf.data) return { error: perf.error ?? "광고비를 불러오지 못했습니다." };
  const prof = new Map((profiles ?? []).map((p) => [(p.staff as unknown as { name: string } | null)?.name ?? "", { track: p.track as string, viral: !!p.viral_in_spend }]));
  const by = new Map<string, { naver: number; meta: number; viral: number }>();
  const row = (n: string) => by.get(n) ?? (by.set(n, { naver: 0, meta: 0, viral: 0 }), by.get(n)!);
  for (const r of perf.data.naver) row(r.manager).naver += Number(r.cost);
  for (const r of perf.data.meta) row(r.manager).meta += Number(r.spend) / 1.1;
  const sname = new Map((staff ?? []).map((x) => [x.id, x.name]));
  for (const r of (viral ?? []) as { staff_id: string; own_sales: number }[]) {
    const n = sname.get(r.staff_id);
    if (n && Number(r.own_sales)) row(n).viral += Number(r.own_sales);
  }
  const rows: SpendFill = [...by.entries()].map(([name, v]) => {
    const p = prof.get(name);
    if (p?.track === "lead") return { name, actual: Math.round(v.naver), teamAmount: null, basis: "팀장: 네이버 (카카오는 직접 더하기)" };
    const withViral = p ? p.viral : true;
    const nm = Math.round(v.naver + v.meta);
    return withViral && v.viral
      ? { name, actual: nm + Math.round(v.viral), teamAmount: nm, basis: "네이버 + 메타 + 바이럴, 팀 산정은 네이버 + 메타" }
      : { name, actual: nm, teamAmount: null, basis: "네이버 + 메타" };
  });
  return { rows, through: perf.data.naver_through };
}
