"use client";

import { useActionState, useState } from "react";
import type { OpsForm } from "./ops-actions";

type Action = (p: OpsForm, f: FormData) => Promise<OpsForm>;
const WD = [["1", "월"], ["2", "화"], ["3", "수"], ["4", "목"], ["5", "금"], ["6", "토"], ["7", "일"]] as const;

export function RoutineForm({ action, staff, advertisers, defaultStaff }: { action: Action; staff: { id: string; name: string }[]; advertisers: string[]; defaultStaff: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [kind, setKind] = useState("weekly");
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[2fr_1.4fr_1fr]">
        <input name="title" placeholder="할 일 (예: 주간 보고서 발송, 노출 순위 체크, 예산 증액 약속)" className="field" required aria-label="할 일" />
        <input name="advertiser_name" list="ops-advertisers" placeholder="광고주 (선택)" className="field" aria-label="광고주" />
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="field" aria-label="주기">
          <option value="weekly">매주</option>
          <option value="monthly">매월</option>
          <option value="daily">평일 매일</option>
          <option value="once">약속 (한 번)</option>
        </select>
      </div>
      <datalist id="ops-advertisers">{advertisers.map((a) => <option key={a} value={a} />)}</datalist>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {kind === "weekly" && (
          <span className="flex flex-wrap items-center gap-1">
            {WD.map(([v, l]) => (
              <label key={v} className="cursor-pointer">
                <input type="checkbox" name="weekdays" value={v} defaultChecked={v === "1"} className="peer sr-only" />
                <span className="inline-block rounded-lg border border-[#dbe3ee] px-2.5 py-1 text-xs peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white">{l}</span>
              </label>
            ))}
          </span>
        )}
        {kind === "monthly" && (
          <select name="month_day" defaultValue="1" className="field !w-auto" aria-label="매월 날짜">
            {Array.from({ length: 30 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}일</option>)}
            <option value="31">말일</option>
          </select>
        )}
        {kind === "once" && <input type="date" name="due_date" className="field !w-auto" required aria-label="약속 날짜" />}
        <label className="flex items-center gap-1 text-xs text-ink-soft">시간 (선택)<input type="time" name="due_time" className="field !w-auto !py-1.5" /></label>
        {staff.length > 1 && (
          <select name="staff_id" defaultValue={defaultStaff} className="field !w-auto" aria-label="담당">
            {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}
        <input name="memo" placeholder="메모 (선택)" className="field !w-56" aria-label="메모" />
        <button className="btn" disabled={pending}>{pending ? "등록 중…" : "등록"}</button>
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
        {state.ok && <span className="text-xs text-[var(--ok-ink)]">{state.ok}</span>}
      </div>
    </form>
  );
}

export function LeadContactForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  if (state.ok) return <span className="chip chip-ok">기록 완료</span>;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <select name="type" defaultValue="전화" className="field !w-auto !py-1 text-xs" aria-label="연락 방법">
        {["전화", "문자", "카카오톡", "이메일", "미팅", "기타"].map((t) => <option key={t}>{t}</option>)}
      </select>
      <input name="content" placeholder="내용 (비우면 '다시 연락 시도')" className="field !w-48 !py-1 text-xs" aria-label="내용" />
      <input type="date" name="next_contact_on" className="field !w-auto !py-1 text-xs" aria-label="다음 연락일" title="다음 연락일 (선택)" />
      <button className="btn !px-3 !py-1 text-xs" disabled={pending}>{pending ? "…" : "연락함"}</button>
      {state.error && <span className="w-full text-[11px] text-danger">{state.error}</span>}
    </form>
  );
}
