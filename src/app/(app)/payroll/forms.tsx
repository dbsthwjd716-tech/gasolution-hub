"use client";

import { useActionState, useMemo, useState } from "react";
import { calcPay, TRACK_LABEL, type Auto, type Extra, type Inputs, type Profile, type Tier } from "@/lib/payroll";
import type { FormState } from "./actions";

type Action = (p: FormState, f: FormData) => Promise<FormState>;
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const toNum = (v: string) => Number(v.replace(/[^\d.]/g, "") || 0);
const fmt = (v: string) => (v.replace(/[^\d]/g, "") ? won(toNum(v)) : "");

function Message({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

function MoneyInput({ name, label, value, onChange, hint, disabled }: { name: string; label: string; value: string; onChange: (v: string) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="text-xs text-ink-soft">
      {label}
      <input name={name} inputMode="numeric" value={value} disabled={disabled} onChange={(e) => onChange(fmt(e.target.value))} placeholder="0" className="field mt-1 text-right tabular-nums" />
      {hint && <span className="mt-0.5 block text-[11px]">{hint}</span>}
    </label>
  );
}

// 직원 한 명의 이달 급여: 입력하면 바로 다시 계산해서 보여 줌
export function EntryEditor({ action, profile, tiers, auto, inputs, extras, memo, readOnly }: {
  action: Action;
  profile: Profile;
  tiers: Tier[];
  auto: Auto;
  inputs: Inputs;
  extras: Extra[];
  memo: string | null;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [v, setV] = useState<Record<keyof Inputs, string>>(() => {
    const o = {} as Record<keyof Inputs, string>;
    for (const k of Object.keys(inputs) as (keyof Inputs)[]) o[k] = inputs[k] ? won(inputs[k]) : "";
    return o;
  });
  const [ex, setEx] = useState<{ label: string; amount: string }[]>(() => [...extras.map((e) => ({ label: e.label, amount: String(e.amount) })), { label: "", amount: "" }]);
  const set = (k: keyof Inputs) => (s: string) => setV((p) => ({ ...p, [k]: s }));
  const live = useMemo(() => {
    const i = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, toNum(s)])) as Inputs;
    return calcPay(profile, i, auto, tiers, ex.map((e) => ({ label: e.label, amount: Number(e.amount.replace(/[^\d-]/g, "")) || 0 })));
  }, [v, ex, profile, auto, tiers]);

  const lead = profile.track === "lead";
  return (
    <form action={formAction} className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <MoneyInput name="naver_spend" label="네이버 소진액 (본인)" value={v.naver_spend} onChange={set("naver_spend")} disabled={readOnly} />
          {!lead && <MoneyInput name="handover_spend" label="인계받은 계정 소진액" value={v.handover_spend} onChange={set("handover_spend")} hint="마감 소진액 100%, 직급·팀 기준 제외" disabled={readOnly} />}
          <MoneyInput name="other_spend" label="네이버 외 매체 소진액" value={v.other_spend} onChange={set("other_spend")} hint={profile.other_in_spend ? "마감 소진액에 합산" : lead ? "매니저 0.2% 기준으로 쓰임" : "마감 소진액에 넣지 않음"} disabled={readOnly} />
          {profile.markup_rate > 0 && <MoneyInput name="markup_fee" label="메타·구글 마크업 수수료 (VAT 포함)" value={v.markup_fee} onChange={set("markup_fee")} disabled={readOnly} />}
          {profile.coupang_rate > 0 && <MoneyInput name="coupang_fee" label="쿠팡 마크업 수수료" value={v.coupang_fee} onChange={set("coupang_fee")} disabled={readOnly} />}
          <MoneyInput name="unpaid_markup_fee" label="받지 못한 마크업 수수료" value={v.unpaid_markup_fee} onChange={set("unpaid_markup_fee")} hint="50% 차감" disabled={readOnly} />
        </div>
        <p className="text-xs text-ink-soft">
          바이럴 (통합 시스템 자동, VAT 별도·인센티브 제외 상품 뺌): 담당 <b className="tabular-nums">{won(auto.viral_sales)}원</b>
          {auto.derived_sales > 0 && <> · 파생 <b className="tabular-nums">{won(auto.derived_sales)}원</b></>}
          {lead && <> · 팀원 네이버 소진액 <b className="tabular-nums">{won(auto.team_naver)}원</b></>}
          {profile.other_media_rate > 0 && <> · 팀장 네이버 외 매체 <b className="tabular-nums">{won(auto.lead_other_spend)}원</b></>}
        </p>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink-soft">기타 (프로모션 달성·조정 등, 빼는 금액은 앞에 -)</p>
          {ex.map((e, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr] gap-2">
              <input name="extra_label" value={e.label} disabled={readOnly} onChange={(x) => setEx((p) => { const n = [...p]; n[i] = { ...n[i], label: x.target.value }; return i === p.length - 1 && x.target.value ? [...n, { label: "", amount: "" }] : n; })} placeholder="항목 (예: 프로모션 달성)" className="field" aria-label="기타 항목" />
              <input name="extra_amount" value={e.amount} disabled={readOnly} inputMode="numeric" onChange={(x) => setEx((p) => { const n = [...p]; n[i] = { ...n[i], amount: x.target.value.replace(/[^\d-]/g, "") }; return n; })} placeholder="0" className="field text-right tabular-nums" aria-label="기타 금액" />
            </div>
          ))}
        </div>
        <input name="memo" defaultValue={memo ?? ""} disabled={readOnly} placeholder="메모" className="field" aria-label="메모" />
        {!readOnly && <button className="btn" disabled={pending}>{pending ? "저장 중…" : "저장"}</button>}
        <Message state={state} />
      </div>
      <div className="rounded-xl bg-white/70 p-3">
        <p className="text-xs text-ink-soft">마감 소진액 <b className="tabular-nums text-ink">{won(live.spend)}원</b> · {TRACK_LABEL[profile.track]}</p>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {live.lines.map((l, i) => (
              <tr key={i} className="border-t border-[var(--glass-border)] align-top">
                <td className="py-1">{l.label}{l.note && <span className="block text-[11px] text-ink-soft">{l.note}</span>}</td>
                <td className={`py-1 text-right tabular-nums ${l.amount < 0 ? "text-danger" : ""}`}>{won(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[var(--glass-border)] font-bold">
              <td className="py-1.5">지급 예정액</td>
              <td className="py-1.5 text-right tabular-nums">{won(live.total)}원</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-ink-soft">항목마다 원 미만 버림. 세전 금액 (4대보험·세금 공제 전)</p>
      </div>
    </form>
  );
}

export function MonthForm({ action, goal, bonus, memo, readOnly }: { action: Action; goal: number; bonus: number; memo: string | null; readOnly: boolean }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [g, setG] = useState(goal ? won(goal) : "");
  const [b, setB] = useState(won(bonus));
  return (
    <form action={formAction} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
      <MoneyInput name="team_goal" label="팀 목표 (팀원 네이버 소진액)" value={g} onChange={setG} disabled={readOnly} />
      <MoneyInput name="team_bonus" label="달성 시 1인 지급" value={b} onChange={setB} disabled={readOnly} />
      <label className="text-xs text-ink-soft">메모<input name="memo" defaultValue={memo ?? ""} disabled={readOnly} className="field mt-1" /></label>
      {!readOnly && <button className="btn btn-ghost" disabled={pending}>{pending ? "…" : "저장"}</button>}
      <div className="sm:col-span-4"><Message state={state} /></div>
    </form>
  );
}

const pctStr = (r: number) => (r ? String(+(r * 100).toFixed(3)) : "");

export function ProfileForm({ action, initial, staff }: { action: Action; initial?: Profile & { is_active: boolean; memo: string | null }; staff?: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [track, setTrack] = useState<Profile["track"]>(initial?.track ?? "nonsales_ae");
  const rate = (name: keyof Profile, label: string, hint?: string) => (
    <label className="text-xs text-ink-soft">{label}
      <span className="mt-1 flex items-center gap-1"><input name={name} inputMode="decimal" defaultValue={initial ? pctStr(initial[name] as number) : ""} placeholder="0" className="field text-right tabular-nums" /><span>%</span></span>
      {hint && <span className="mt-0.5 block text-[11px]">{hint}</span>}
    </label>
  );
  const check = (name: keyof Profile | "is_active", label: string, def: boolean) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={def} />{label}</label>
  );
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {staff && (
          <label className="text-xs text-ink-soft">직원
            <select name="staff_id" className="field mt-1" required defaultValue="">
              <option value="">골라 주세요</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-ink-soft">직군
          <select name="track" value={track} onChange={(e) => setTrack(e.target.value as Profile["track"])} className="field mt-1">
            {Object.entries(TRACK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">기본급{track === "lead" ? " + 직책수당" : ""}
          <input name="base_pay" inputMode="numeric" defaultValue={initial?.base_pay ? won(initial.base_pay) : ""} className="field mt-1 text-right tabular-nums" />
        </label>
        <label className="text-xs text-ink-soft">자격증 수당
          <input name="cert_allowance" inputMode="numeric" defaultValue={initial?.cert_allowance ? won(initial.cert_allowance) : ""} className="field mt-1 text-right tabular-nums" />
        </label>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {check("probation", "수습 (기본급 90%)", initial?.probation ?? false)}
        {track !== "lead" && check("rank_allowance", "직급수당 받음", initial?.rank_allowance ?? true)}
        {track !== "lead" && check("other_in_spend", "네이버 외 매체를 마감 소진액에 합산", initial?.other_in_spend ?? false)}
        {track !== "lead" && check("viral_in_spend", "바이럴 판매가를 마감 소진액에 합산", initial?.viral_in_spend ?? false)}
        {check("is_active", "급여 계산 대상", initial?.is_active ?? true)}
      </div>
      <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {rate("viral_rate", "바이럴", "마감 소진액에 합산하지 않을 때")}
        {rate("derived_rate", "파생 바이럴")}
        {track === "lead" && rate("closing_rate", "마감 매출")}
        {track === "lead" && rate("team_rate", "팀 수당", "팀원 네이버 소진액 기준")}
        {rate("markup_rate", "메타·구글 마크업", "수수료 VAT 별도 기준")}
        {rate("coupang_rate", "쿠팡")}
        {rate("other_media_rate", "네이버 외 매체", "본인 + 팀장 소진액 기준")}
      </div>
      <input name="memo" defaultValue={initial?.memo ?? ""} placeholder="메모" className="field" aria-label="메모" />
      <button className="btn" disabled={pending}>{pending ? "…" : "저장"}</button>
      <Message state={state} />
    </form>
  );
}

export function TierForm({ action, initial, kind }: { action: Action; initial?: Tier; kind: Tier["kind"] }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [min, setMin] = useState(initial ? won(initial.min_spend) : "");
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input name="min_spend" value={min} onChange={(e) => setMin(fmt(e.target.value))} inputMode="numeric" placeholder="소진액 이상" className="field w-40 text-right tabular-nums" aria-label="소진액 이상" />
      {kind === "rank" ? (
        <>
          <input name="rank_name" defaultValue={initial?.rank_name ?? ""} placeholder="직급" className="field w-24" aria-label="직급" />
          <input name="amount" defaultValue={initial?.amount ? won(initial.amount) : ""} inputMode="numeric" placeholder="수당" className="field w-28 text-right tabular-nums" aria-label="직급수당" />
        </>
      ) : (
        <span className="flex items-center gap-1"><input name="rate" defaultValue={initial ? pctStr(initial.rate ?? 0) : ""} inputMode="decimal" placeholder="요율" className="field w-20 text-right tabular-nums" aria-label="요율" />%</span>
      )}
      <button className="btn btn-ghost" disabled={pending}>{pending ? "…" : initial ? "저장" : "추가"}</button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

// 기존 대시보드에서 네이버·메타 소진액 불러오기
export function DashboardImport({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-1">
      <button className="btn btn-ghost" disabled={pending}>{pending ? "불러오는 중…" : "대시보드에서 소진액 불러오기"}</button>
      <p className="text-[11px] text-ink-soft">네이버(이관 광고비)·메타 소진액, 그리고 「광고비 실적」에서 인계건으로 지정한 계정의 소진액(서진원 인계 계정, 100%)을 채웁니다. 카카오 등 대시보드에 없는 매체는 불러온 뒤 직접 더해 주세요.</p>
      <Message state={state} />
    </form>
  );
}
