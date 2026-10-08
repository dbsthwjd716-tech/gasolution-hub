"use client";

import { useActionState, useState } from "react";
import type { FormState } from "./actions";

type Action = (p: FormState, f: FormData) => Promise<FormState>;

function Message({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-xs text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

const comma = (v: string) => {
  const d = v.replace(/[^\d]/g, "");
  return d ? Number(d).toLocaleString("ko-KR") : "";
};

function MoneyInput({ name, value, label, className = "" }: { name: string; value: number; label: string; className?: string }) {
  const [v, setV] = useState(value ? value.toLocaleString("ko-KR") : "");
  return <input name={name} value={v} onChange={(e) => setV(comma(e.target.value))} inputMode="numeric" aria-label={label} placeholder="0" className={`field text-right tabular-nums ${className}`} />;
}

export function NewWeekForm({ action, defaultDay }: { action: Action; defaultDay: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-ink-soft">평가할 주 (그 주의 아무 날짜)
        <input type="date" name="week_of" defaultValue={defaultDay} className="field mt-1" required />
      </label>
      <button className="btn" disabled={pending}>{pending ? "만드는 중…" : "주차 만들기"}</button>
      <p className="w-full text-xs text-ink-soft">월~일 한 주를 평가하고, 기준은 그 직전 주(월~일)입니다. 목표는 바로 전 주차에서 복사되니 만든 뒤 고쳐 주세요.</p>
      <Message state={state} />
    </form>
  );
}

export type EditTarget = { staff_id: string; name: string; increment: number; scope: "naver" | "naver_meta"; in_team: boolean };
export type EditWeek = {
  id: string; title: string | null; base_start: string; base_end: string; week_start: string; week_end: string;
  team_increment: number; reward_personal: string; reward_team: string; memo: string | null;
  reward_personal_hours: number; reward_team_hours: number;
};

export function WeekForm({ action, week, targets, individualSum }: { action: Action; week: EditWeek; targets: EditTarget[]; individualSum: number }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-ink-soft lg:col-span-1">이름 (선택)
          <input name="title" defaultValue={week.title ?? ""} placeholder="예: 10월 2주차" className="field mt-1" />
        </label>
        <label className="text-xs text-ink-soft">기준 주 시작
          <input type="date" name="base_start" defaultValue={week.base_start} className="field mt-1" />
        </label>
        <label className="text-xs text-ink-soft">기준 주 끝
          <input type="date" name="base_end" defaultValue={week.base_end} className="field mt-1" />
        </label>
        <label className="text-xs text-ink-soft">평가 주 시작
          <input type="date" name="week_start" defaultValue={week.week_start} className="field mt-1" />
        </label>
        <label className="text-xs text-ink-soft">평가 주 끝
          <input type="date" name="week_end" defaultValue={week.week_end} className="field mt-1" />
        </label>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-soft">
          <tr><th className="py-1">대상</th><th>일소진 상승 목표 (원)</th><th>광고비 범위</th><th>팀 합산</th></tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-border)]">
          {targets.map((t) => (
            <tr key={t.staff_id}>
              <td className="py-1.5 font-semibold">{t.name}</td>
              <td><MoneyInput name={`inc:${t.staff_id}`} value={t.increment} label={`${t.name} 상승 목표`} className="!w-36 !py-1" /></td>
              <td>
                <select name={`scope:${t.staff_id}`} defaultValue={t.scope} className="field !w-auto !py-1 text-xs">
                  <option value="naver">네이버만 (인계건·바이럴 제외)</option>
                  <option value="naver_meta">네이버 + 메타 (바이럴 제외)</option>
                </select>
              </td>
              <td><input type="checkbox" name={`team:${t.staff_id}`} defaultChecked={t.in_team} aria-label={`${t.name} 팀 합산`} /></td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5 font-bold">팀</td>
            <td><MoneyInput name="team_increment" value={week.team_increment} label="팀 상승 목표" className="!w-36 !py-1" /></td>
            <td colSpan={2} className="text-xs text-ink-soft">개인 목표 합계 {individualSum.toLocaleString("ko-KR")}원</td>
          </tr>
        </tbody>
      </table>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs text-ink-soft">개인 달성 조기퇴근 (시간)
          <input name="reward_personal_hours" inputMode="decimal" defaultValue={week.reward_personal_hours} className="field mt-1 text-right" />
        </label>
        <label className="text-xs text-ink-soft">팀 달성 금요일 조기퇴근 (시간)
          <input name="reward_team_hours" inputMode="decimal" defaultValue={week.reward_team_hours} className="field mt-1 text-right" />
        </label>
        <label className="text-xs text-ink-soft">개인 달성 사용 방법
          <input name="reward_personal" defaultValue={week.reward_personal} className="field mt-1" />
        </label>
        <label className="text-xs text-ink-soft">팀 달성 사용 방법
          <input name="reward_team" defaultValue={week.reward_team} className="field mt-1" />
        </label>
      </div>
      <input name="memo" defaultValue={week.memo ?? ""} placeholder="메모 (예: 추석 연휴로 목표 조정)" className="field" aria-label="메모" />
      <button className="btn btn-ghost" disabled={pending}>{pending ? "저장 중…" : "목표 저장"}</button>
      <Message state={state} />
    </form>
  );
}

export function AddTargetForm({ action, staff }: { action: Action; staff: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  if (!staff.length) return null;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 text-xs">
      <select name="staff_id" className="field !w-auto !py-1 text-xs" aria-label="대상 추가">
        {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <MoneyInput name="increment" value={0} label="상승 목표" className="!w-28 !py-1 text-xs" />
      <select name="scope" defaultValue="naver_meta" className="field !w-auto !py-1 text-xs" aria-label="광고비 범위">
        <option value="naver">네이버만</option>
        <option value="naver_meta">네이버 + 메타</option>
      </select>
      <button className="btn btn-ghost !px-3 !py-1 text-xs" disabled={pending}>대상 추가</button>
      <Message state={state} />
    </form>
  );
}

export function CopyNotice({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost !px-3 !py-1.5 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt("아래 내용을 복사해 주세요", text);
        }
      }}
    >
      {done ? "복사했습니다" : label}
    </button>
  );
}
