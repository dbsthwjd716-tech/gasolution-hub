import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { TRACK_LABEL, type Tier } from "@/lib/payroll";
import { ConfirmSubmit } from "../../billing/panel";
import { deleteTier, saveProfile, saveTier } from "../actions";
import { loadProfiles, loadTiers } from "../data";
import { ProfileForm, TierForm } from "../forms";

const KIND_LABEL: Record<Tier["kind"], string> = {
  sales_ae: "영업 AE 인센티브 요율 (마감 소진액 × 13% × 요율)",
  nonsales_ae: "비영업 AE 인센티브 요율 (마감 소진액 × 13% × 요율)",
  rank: "직급수당 (인계 계정 뺀 본인 실적 기준)",
};

export default async function PayrollSettings() {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">급여 설정은 대표·팀장만 볼 수 있습니다.</p>;
  const [profiles, tiers, { data: staff }] = await Promise.all([
    loadProfiles(supabase),
    loadTiers(supabase),
    supabase.from("staff").select("id,name").eq("is_active", true).order("name"),
  ]);
  const without = (staff ?? []).filter((s) => !profiles.some((p) => p.staff_id === s.id));
  const order = { lead: 0, sales_ae: 1, nonsales_ae: 2 } as const;

  return (
    <div className="space-y-4">
      <Link href="/payroll" className="text-sm text-ink-soft hover:text-brand">← 급여 · 인센티브</Link>
      <header>
        <h1 className="text-2xl font-bold">급여 설정 · 구간표</h1>
        <p className="text-sm text-ink-soft">직원별 직군·기본급·요율과 소진액 구간표입니다. 바꾸면 아직 마감하지 않은 달에 바로 반영됩니다 (마감한 달은 그대로).</p>
      </header>

      {profiles.sort((a, b) => order[a.track] - order[b.track] || a.name.localeCompare(b.name)).map((p) => (
        <section key={p.staff_id} className="glass p-5">
          <h2 className="mb-3 font-bold">{p.name} <span className="text-xs font-normal text-ink-soft">{TRACK_LABEL[p.track]}{p.is_active ? "" : " · 계산 제외"}</span></h2>
          <ProfileForm action={saveProfile.bind(null, p.staff_id)} initial={p} />
        </section>
      ))}
      {without.length > 0 && (
        <details className="glass p-5">
          <summary className="cursor-pointer font-bold">직원 급여 설정 추가</summary>
          <div className="mt-3"><ProfileForm action={saveProfile.bind(null, null)} staff={without} /></div>
        </details>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {(["sales_ae", "nonsales_ae", "rank"] as const).map((kind) => (
          <section key={kind} className="glass space-y-2 p-5">
            <h2 className="text-sm font-bold">{KIND_LABEL[kind]}</h2>
            <p className="text-xs text-ink-soft">소진액이 이 금액 이상이면 해당 구간. 가장 낮은 구간보다 적으면 없음.</p>
            {tiers.filter((t) => t.kind === kind).map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <TierForm action={saveTier.bind(null, t.id)} initial={t} kind={kind} />
                <ConfirmSubmit action={deleteTier.bind(null, t.id)} label="삭제" confirmText="이 구간을 지울까요?" />
              </div>
            ))}
            <div className="border-t border-[var(--glass-border)] pt-2"><TierForm action={saveTier.bind(null, null)} kind={kind} /></div>
          </section>
        ))}
      </div>
    </div>
  );
}
