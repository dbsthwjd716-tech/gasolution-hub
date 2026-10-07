"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/supabase/server";
import { EMPTY_INPUTS, type Inputs } from "@/lib/payroll";
import { fetchDashboardSpend } from "@/lib/dashboard";
import { loadPayrollMonth, shiftYm, ymToDate } from "./data";

export type FormState = { error: string; ok?: string };

const amount = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? "").trim();
  if (!v) return 0;
  const n = Number(v.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
// 화면에는 % 로 입력 (10 → 0.1)
const percent = (f: FormData, k: string) => {
  const n = amount(f, k);
  return Number.isNaN(n) ? NaN : Math.round(n * 1000) / 100000;
};
const isYm = (ym: string) => /^\d{4}-\d{2}$/.test(ym);

async function manager() {
  const { supabase, me } = await getMe();
  if (!me) redirect("/login");
  if (me.role === "staff") throw new Error("대표·팀장만 할 수 있습니다");
  return { supabase, me };
}

function friendly(message: string) {
  if (message.includes("마감") || message.includes("대표")) return message;
  if (message.includes("row-level security")) return "권한이 없습니다.";
  return "저장하지 못했습니다: " + message;
}

const touch = (ym?: string) => {
  revalidatePath("/payroll");
  if (ym) revalidatePath(`/payroll?m=${ym}`);
};

// 이 달 급여 시작: 급여 설정이 켜진 직원마다 한 줄씩, 팀 목표는 지난달 값으로
export async function startMonth(ym: string) {
  const { supabase } = await manager();
  if (!isYm(ym)) return;
  const { data: prev } = await supabase.from("payroll_months").select("team_goal,team_bonus").eq("month", ymToDate(shiftYm(ym, -1))).maybeSingle();
  await supabase.from("payroll_months").insert({ month: ymToDate(ym), team_goal: prev?.team_goal ?? 0, team_bonus: prev?.team_bonus ?? 100000 });
  const { data: profiles } = await supabase.from("payroll_profiles").select("staff_id").eq("is_active", true);
  if (profiles?.length) {
    await supabase.from("payroll_entries").upsert(
      profiles.map((p) => ({ month: ymToDate(ym), staff_id: p.staff_id, inputs: EMPTY_INPUTS })),
      { onConflict: "month,staff_id", ignoreDuplicates: true },
    );
  }
  touch(ym);
}

export async function addEntry(ym: string, staffId: string) {
  const { supabase } = await manager();
  await supabase.from("payroll_entries").insert({ month: ymToDate(ym), staff_id: staffId, inputs: EMPTY_INPUTS });
  touch(ym);
}

export async function removeEntry(ym: string, entryId: string) {
  const { supabase } = await manager();
  await supabase.from("payroll_entries").delete().eq("id", entryId);
  touch(ym);
}

const INPUT_KEYS: (keyof Inputs)[] = ["naver_spend", "handover_spend", "other_spend", "markup_fee", "coupang_fee", "unpaid_markup_fee"];

export async function saveEntry(ym: string, entryId: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await manager();
  const inputs = { ...EMPTY_INPUTS };
  for (const k of INPUT_KEYS) {
    const v = amount(f, k);
    if (Number.isNaN(v) || v < 0) return { error: "금액은 0 이상 숫자로 입력해 주세요." };
    inputs[k] = v;
  }
  const labels = f.getAll("extra_label").map(String);
  const amounts = f.getAll("extra_amount").map((v) => Number(String(v).replace(/[^\d-]/g, "")));
  const extras = labels.map((label, i) => ({ label: label.trim().slice(0, 60), amount: amounts[i] || 0 })).filter((e) => e.label && e.amount);
  const memo = String(f.get("memo") ?? "").trim() || null;
  const { error } = await supabase.from("payroll_entries").update({ inputs, extras, memo }).eq("id", entryId);
  if (error) return { error: friendly(error.message) };
  touch(ym);
  return { error: "", ok: "저장했습니다." };
}

export async function saveMonth(ym: string, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await manager();
  const goal = amount(f, "team_goal");
  const bonus = amount(f, "team_bonus");
  if (Number.isNaN(goal) || Number.isNaN(bonus) || goal < 0 || bonus < 0) return { error: "금액을 확인해 주세요." };
  const memo = String(f.get("memo") ?? "").trim() || null;
  const { error } = await supabase.from("payroll_months").update({ team_goal: goal, team_bonus: bonus, memo }).eq("month", ymToDate(ym));
  if (error) return { error: friendly(error.message) };
  touch(ym);
  return { error: "", ok: "저장했습니다." };
}

// 마감: 지금 계산 결과를 그대로 보관하고 잠금
export async function closeMonth(ym: string) {
  const { supabase } = await manager();
  const { rows } = await loadPayrollMonth(supabase, ym);
  const results = rows.map((r) => ({ staff_id: r.staff_id, total: r.total, snapshot: { spend: r.spend, lines: r.lines, auto: r.auto, inputs: r.inputs } }));
  const { error } = await supabase.rpc("payroll_close", { m: ymToDate(ym), results });
  touch(ym);
  if (error) redirect(`/payroll?m=${ym}&error=${encodeURIComponent(friendly(error.message))}`);
}

export async function reopenMonth(ym: string) {
  const { supabase } = await manager();
  const { error } = await supabase.rpc("payroll_reopen", { m: ymToDate(ym) });
  touch(ym);
  if (error) redirect(`/payroll?m=${ym}&error=${encodeURIComponent(friendly(error.message))}`);
}

// ---------------------------------------------------------------- 설정
export async function saveProfile(staffId: string | null, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await manager();
  const sid = staffId ?? String(f.get("staff_id") ?? "");
  if (!sid) return { error: "직원을 골라 주세요." };
  const track = String(f.get("track") ?? "");
  if (!["lead", "sales_ae", "nonsales_ae"].includes(track)) return { error: "직군을 골라 주세요." };
  const row = {
    staff_id: sid,
    track,
    base_pay: amount(f, "base_pay"),
    cert_allowance: amount(f, "cert_allowance"),
    probation: f.get("probation") === "on",
    rank_allowance: f.get("rank_allowance") === "on",
    viral_in_spend: f.get("viral_in_spend") === "on",
    other_in_spend: f.get("other_in_spend") === "on",
    viral_rate: percent(f, "viral_rate"),
    derived_rate: percent(f, "derived_rate"),
    closing_rate: percent(f, "closing_rate"),
    team_rate: percent(f, "team_rate"),
    markup_rate: percent(f, "markup_rate"),
    coupang_rate: percent(f, "coupang_rate"),
    other_media_rate: percent(f, "other_media_rate"),
    is_active: f.get("is_active") === "on",
    memo: String(f.get("memo") ?? "").trim() || null,
  };
  if (Object.values(row).some((v) => typeof v === "number" && (Number.isNaN(v) || v < 0))) return { error: "숫자를 확인해 주세요." };
  const { error } = await supabase.from("payroll_profiles").upsert(row, { onConflict: "staff_id" });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/payroll/settings");
  touch();
  return { error: "", ok: "저장했습니다." };
}

export async function saveTier(id: string | null, _p: FormState, f: FormData): Promise<FormState> {
  const { supabase } = await manager();
  const kind = String(f.get("kind") ?? "");
  if (!["sales_ae", "nonsales_ae", "rank"].includes(kind)) return { error: "구간 종류가 올바르지 않습니다." };
  const min = amount(f, "min_spend");
  if (Number.isNaN(min) || min < 0) return { error: "소진액을 확인해 주세요." };
  const row: { kind: string; min_spend: number; rate: number | null; rank_name: string | null; amount: number | null } =
    kind === "rank"
      ? { kind, min_spend: min, rate: null, rank_name: String(f.get("rank_name") ?? "").trim() || null, amount: amount(f, "amount") }
      : { kind, min_spend: min, rate: percent(f, "rate"), rank_name: null, amount: null };
  if (kind === "rank" && !row.rank_name) return { error: "직급 이름을 입력해 주세요." };
  if (Number.isNaN(row.rate ?? 0) || Number.isNaN(row.amount ?? 0)) return { error: "숫자를 확인해 주세요." };
  const { error } = id ? await supabase.from("payroll_tiers").update(row).eq("id", id) : await supabase.from("payroll_tiers").insert(row);
  if (error) return { error: error.message.includes("duplicate") ? "같은 소진액 구간이 이미 있습니다." : friendly(error.message) };
  revalidatePath("/payroll/settings");
  touch();
  return { error: "", ok: "저장했습니다." };
}

export async function deleteTier(id: string) {
  const { supabase } = await manager();
  await supabase.from("payroll_tiers").delete().eq("id", id);
  revalidatePath("/payroll/settings");
  touch();
}

// 기존 대시보드에서 소진액 불러오기: 네이버 소진액(VAT 제외) → '네이버 소진액', 메타 소진액 ÷ 1.1 → '네이버 외 매체 소진액'
// 진원 인계건(대시보드 그룹 급여 구분) 소진액은 서진원의 인계 계정 소진액으로. 카카오 등 대시보드에 없는 매체는 직접 더함
export async function importDashboardSpend(ym: string, _p: FormState, _f: FormData): Promise<FormState> {
  const { supabase } = await manager();
  const { rows, error } = await fetchDashboardSpend(ymToDate(ym));
  if (error) return { error };
  const { data: entries } = await supabase.from("payroll_entries").select("id,inputs,staff:staff_id(name)").eq("month", ymToDate(ym));
  const done: string[] = [];
  for (const e of entries ?? []) {
    const name = (e.staff as unknown as { name: string } | null)?.name;
    const d = rows.find((r) => r.employee_name === name);
    if (!d) continue;
    const inputs = {
      ...EMPTY_INPUTS,
      ...(e.inputs as Partial<Inputs>),
      naver_spend: d.naver_spend,
      other_spend: Math.round(d.meta_spend / 1.1),
      handover_spend: d.handover_spend,
    };
    const { error: ue } = await supabase.from("payroll_entries").update({ inputs }).eq("id", e.id);
    if (ue) return { error: friendly(ue.message) };
    const ho = d.handover_spend;
    done.push(`${name} 네이버 ${d.naver_spend.toLocaleString("ko-KR")} · 메타 ${Math.round(d.meta_spend / 1.1).toLocaleString("ko-KR")}${ho ? ` · 인계 ${ho.toLocaleString("ko-KR")}` : ""}`);
  }
  touch(ym);
  return done.length ? { error: "", ok: `불러왔습니다 — ${done.join(" / ")}` } : { error: "이 달 급여 직원과 이름이 맞는 대시보드 담당자가 없습니다." };
}
