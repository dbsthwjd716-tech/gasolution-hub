"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/supabase/server";
import { computePromo, previousWeek, weekOf, mondayOf, type PromoTarget } from "@/lib/promo";
import { fetchPromoSpend } from "@/lib/ads-legacy";

export type FormState = { error: string; ok?: string };

const s = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  return v.length ? v : null;
};
const money = (f: FormData, k: string) => Math.round(Number(String(f.get(k) ?? "").replace(/[^\d]/g, "") || 0));
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

function friendly(m: string) {
  if (m.includes("row-level security") || m.includes("permission")) return "대표·팀장만 고칠 수 있습니다.";
  if (m.includes("promo_weeks_week_start_key") || m.includes("duplicate key")) return "그 주는 이미 만들어져 있습니다.";
  if (m.includes("check constraint")) return "기간을 확인해 주세요. 기준 주가 평가 주보다 앞서야 합니다.";
  return m.replace(/^.*?ERROR:\s*/, "");
}

async function client() {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") throw new Error("대표·팀장만 고칠 수 있습니다.");
  return supabase;
}

const done = (ok: string): FormState => {
  revalidatePath("/promotions");
  revalidatePath("/home");
  return { error: "", ok };
};

// 새 주차: 고른 날짜가 속한 월~일, 기준은 직전 주. 목표는 바로 전 주차에서 복사
export async function createWeek(_p: FormState, f: FormData): Promise<FormState> {
  try {
    const supabase = await client();
    const day = s(f, "week_of");
    if (!isDate(day)) return { error: "평가할 주의 날짜를 골라 주세요." };
    const week = weekOf(mondayOf(day));
    const base = previousWeek(week);
    const { data: last } = await supabase.from("promo_weeks").select("id,team_increment,reward_personal,reward_team,reward_personal_hours,reward_team_hours").lt("week_start", week.start).order("week_start", { ascending: false }).limit(1).maybeSingle();
    const { data: w, error } = await supabase
      .from("promo_weeks")
      .insert({
        base_start: base.start, base_end: base.end, week_start: week.start, week_end: week.end,
        team_increment: last?.team_increment ?? 0,
        ...(last ? { reward_personal: last.reward_personal, reward_team: last.reward_team, reward_personal_hours: last.reward_personal_hours, reward_team_hours: last.reward_team_hours } : {}),
      })
      .select("id")
      .single();
    if (error || !w) return { error: friendly(error?.message ?? "") };
    if (last) {
      const { data: t } = await supabase.from("promo_targets").select("staff_id,increment,scope,in_team").eq("week_id", last.id);
      if (t?.length) await supabase.from("promo_targets").insert(t.map((x) => ({ ...x, week_id: w.id })));
    }
    return done(`${week.start} 주차를 만들었습니다${last ? " (지난 주차 목표를 복사했습니다)" : ""}.`);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveWeek(id: string, _p: FormState, f: FormData): Promise<FormState> {
  try {
    const supabase = await client();
    const row = {
      title: s(f, "title"),
      base_start: s(f, "base_start"), base_end: s(f, "base_end"), week_start: s(f, "week_start"), week_end: s(f, "week_end"),
      team_increment: money(f, "team_increment"),
      reward_personal: s(f, "reward_personal") ?? "",
      reward_team: s(f, "reward_team") ?? "",
      reward_personal_hours: Number(s(f, "reward_personal_hours") ?? 1) || 0,
      reward_team_hours: Number(s(f, "reward_team_hours") ?? 2) || 0,
      memo: s(f, "memo"),
    };
    if (![row.base_start, row.base_end, row.week_start, row.week_end].every((d) => isDate(d))) return { error: "기간을 모두 입력해 주세요." };
    const { error } = await supabase.from("promo_weeks").update(row).eq("id", id);
    if (error) return { error: friendly(error.message) };
    // 개인 목표 (행마다 increment:<staff>, scope:<staff>, team:<staff>)
    for (const [k, v] of f.entries()) {
      if (!k.startsWith("inc:")) continue;
      const sid = k.slice(4);
      const { error: e2 } = await supabase.from("promo_targets").update({
        increment: Math.round(Number(String(v).replace(/[^\d]/g, "") || 0)),
        scope: f.get(`scope:${sid}`) === "naver" ? "naver" : "naver_meta",
        in_team: f.get(`team:${sid}`) === "on",
      }).eq("week_id", id).eq("staff_id", sid);
      if (e2) return { error: friendly(e2.message) };
    }
    return done("저장했습니다. 바꾼 내용은 이력에 남습니다.");
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function addTarget(id: string, _p: FormState, f: FormData): Promise<FormState> {
  try {
    const supabase = await client();
    const sid = s(f, "staff_id");
    if (!sid) return { error: "직원을 골라 주세요." };
    const { error } = await supabase.from("promo_targets").insert({ week_id: id, staff_id: sid, increment: money(f, "increment"), scope: s(f, "scope") === "naver" ? "naver" : "naver_meta" });
    if (error) return { error: friendly(error.message) };
    return done("대상을 추가했습니다.");
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removeTarget(id: string, staffId: string) {
  const supabase = await client();
  await supabase.from("promo_targets").delete().eq("week_id", id).eq("staff_id", staffId);
  revalidatePath("/promotions");
}

// 마감: 지금 계산한 숫자를 결과로 보관 (주가 끝나고 데이터가 다 들어온 뒤)
export async function closeWeek(id: string) {
  const supabase = await client();
  const { data: w } = await supabase.from("promo_weeks").select("*").eq("id", id).single();
  const { data: t } = await supabase.from("promo_targets").select("staff_id,increment,scope,in_team,staff(name)").eq("week_id", id);
  if (!w) return;
  const { data } = await fetchPromoSpend(w.base_start, w.week_end);
  if (!data) return;
  const targets: PromoTarget[] = (t ?? []).map((x) => ({ staff_id: x.staff_id, name: (x.staff as unknown as { name: string }).name, increment: Number(x.increment), scope: x.scope, in_team: x.in_team }));
  const r = computePromo(data, targets, { start: w.base_start, end: w.base_end }, { start: w.week_start, end: w.week_end }, Number(w.team_increment));
  await supabase.rpc("promo_close", { p_week: id, p_results: { ...r, data_through: { naver: data.naver_through, meta: data.meta_through } } });
  revalidatePath("/promotions");
}

export async function reopenWeek(id: string) {
  const supabase = await client();
  await supabase.rpc("promo_reopen", { p_week: id });
  revalidatePath("/promotions");
}
