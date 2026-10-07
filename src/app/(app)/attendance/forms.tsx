"use client";

import { useActionState, useState } from "react";
import { EXCEPTION_TYPE, LEAVE_TYPE, WORK_TYPE, GRANT_MODE } from "@/lib/attendance";
import type { FormState } from "./actions";

type Action = (p: FormState, f: FormData) => Promise<FormState>;

function Message({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-xs text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

// 버튼 하나짜리 처리 (승인·반려·거둬들이기 등)
export function ActButton({ action, op, id, label, tone = "ghost", confirmText, children }: {
  action: Action;
  op: string;
  id?: number | string;
  label: string;
  tone?: "main" | "ghost" | "danger";
  confirmText?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const cls = tone === "main" ? "btn !px-3 !py-1.5 text-xs" : tone === "danger" ? "text-xs text-danger underline" : "btn btn-ghost !px-3 !py-1.5 text-xs";
  return (
    <form action={formAction} onSubmit={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }} className="inline-flex flex-wrap items-center gap-1">
      <input type="hidden" name="op" value={op} />
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      {children}
      <button className={cls} disabled={pending}>{pending ? "…" : label}</button>
      <Message state={state} />
    </form>
  );
}

export function ClockButtons({ action, clockIn, clockOut, blocked }: { action: Action; clockIn: string; clockOut: string; blocked?: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  if (blocked) return <p className="text-sm text-ink-soft">{blocked}</p>;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {!clockIn && <button name="op" value="clock_in" className="btn" disabled={pending}>{pending ? "…" : "출근하기"}</button>}
      {clockIn && !clockOut && (
        <button name="op" value="clock_out" className="btn" disabled={pending}
          onClick={(e) => { if (!window.confirm("지금 퇴근 처리할까요?")) e.preventDefault(); }}>{pending ? "…" : "퇴근하기"}</button>
      )}
      {clockIn && clockOut && <span className="chip chip-ok">오늘 근무 끝</span>}
      <Message state={state} />
    </form>
  );
}

export function LeaveForm({ action, staff, today, resubmitFrom }: {
  action: Action;
  staff?: { id: string; name: string }[];
  today: string;
  resubmitFrom?: { id: number; leave_type: string; start_date: string; end_date: string };
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [type, setType] = useState(resubmitFrom?.leave_type ?? "annual");
  const half = type === "morning_half" || type === "afternoon_half";
  return (
    <form action={formAction} className="space-y-2">
      {resubmitFrom && <input type="hidden" name="resubmitted_from_id" value={resubmitFrom.id} />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {staff && (
          <label className="text-xs text-ink-soft">직원
            <select name="staff_id" className="field mt-1">
              {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-ink-soft">종류
          <select name="leave_type" value={type} onChange={(e) => setType(e.target.value)} className="field mt-1">
            {Object.entries(LEAVE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">{half ? "날짜" : "시작일"}
          <input name="start_date" type="date" defaultValue={resubmitFrom?.start_date ?? today} className="field mt-1" required />
        </label>
        {!half && (
          <label className="text-xs text-ink-soft">끝나는 날
            <input name="end_date" type="date" defaultValue={resubmitFrom?.end_date ?? today} className="field mt-1" required />
          </label>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="reason" placeholder="사유 (선택)" className="field" aria-label="사유" />
        <input name="handover" placeholder="주요 업무 인수인계 (선택)" className="field" aria-label="인수인계" />
      </div>
      <p className="text-xs text-ink-soft">
        반차 0.5일 · 연차는 주말·공휴일을 빼고 계산 · 경조휴가는 연차에서 빠지지 않음 · 포상휴가 차감 여부는 승인할 때 정함
      </p>
      <button className="btn" disabled={pending}>{pending ? "신청 중…" : "휴가 신청"}</button>
      <Message state={state} />
    </form>
  );
}

export function CancelLeaveForm({ action, id }: { action: Action; id: number }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, { error: "" });
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-danger underline">취소 요청</button>;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input name="reason" placeholder="취소 사유" className="field !w-40 !py-1 text-xs" required aria-label="취소 사유" />
      <button className="btn btn-ghost !px-3 !py-1 text-xs" disabled={pending}>{pending ? "…" : "보내기"}</button>
      <Message state={state} />
    </form>
  );
}

export function ExceptionForm({ action, staff, today }: { action: Action; staff?: { id: string; name: string }[]; today: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [type, setType] = useState("other");
  const meeting = type === "meeting" || type === "direct_home";
  const help: Record<string, string> = {
    other: "예비군·병원·교육 등. 시간을 비우면 종일로 처리되어 그날 출퇴근이 필요 없습니다.",
    meeting: "외부 미팅 후 사무실로 돌아오는 경우. 시작시간·장소·내용은 꼭 적어 주세요.",
    direct_home: "미팅 후 바로 퇴근하는 경우. 조퇴로 잡히지 않습니다.",
    birthday_early_leave: "생일이 있는 달의 평일, 1년에 한 번. 퇴근시간은 16:00.",
    promotion_early_leave: "회사 프로모션으로 일찍 퇴근하는 날. 퇴근시간과 사유를 적어 주세요.",
  };
  return (
    <form action={formAction} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {staff && (
          <label className="text-xs text-ink-soft">직원
            <select name="staff_id" className="field mt-1">
              {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-ink-soft">종류
          <select name="exception_type" value={type} onChange={(e) => setType(e.target.value)} className="field mt-1">
            {Object.entries(EXCEPTION_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">날짜
          <input name="work_date" type="date" defaultValue={today} className="field mt-1" required />
        </label>
        {(meeting || type === "other") && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-ink-soft">시작
              <input name="start_time" type="time" className="field mt-1" required={meeting} />
            </label>
            <label className="text-xs text-ink-soft">끝
              <input name="end_time" type="time" className="field mt-1" />
            </label>
          </div>
        )}
        {type === "promotion_early_leave" && (
          <label className="text-xs text-ink-soft">퇴근시간
            <input name="approved_leave_time" type="time" className="field mt-1" required />
          </label>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {meeting && <input name="location" placeholder="장소" className="field" required aria-label="장소" />}
        {type !== "birthday_early_leave" && <input name="note" placeholder={meeting ? "미팅 내용" : "상세 내용"} className="field" required aria-label="내용" />}
      </div>
      <p className="text-xs text-ink-soft">{help[type]}</p>
      <button className="btn" disabled={pending}>{pending ? "신청 중…" : "신청"}</button>
      <Message state={state} />
    </form>
  );
}

export function CorrectionForm({ action, id, workDate, clockIn, clockOut }: { action: Action; id: number; workDate: string; clockIn: string; clockOut: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, { error: "" });
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand underline">수정 요청</button>;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="work_date" value={workDate} />
      <input name="clock_in" type="time" defaultValue={clockIn} className="field !w-28 !py-1 text-xs" aria-label="출근" />
      <input name="clock_out" type="time" defaultValue={clockOut} className="field !w-28 !py-1 text-xs" aria-label="퇴근" />
      <input name="reason" placeholder="수정 사유" className="field !w-40 !py-1 text-xs" required aria-label="수정 사유" />
      <button className="btn btn-ghost !px-3 !py-1 text-xs" disabled={pending}>{pending ? "…" : "요청"}</button>
      <Message state={state} />
    </form>
  );
}

export function RecordForm({ action, staff, defaults }: {
  action: Action;
  staff: { id: string; name: string }[];
  defaults?: { staff_id: string; work_date: string; clock_in: string; clock_out: string; note: string };
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs text-ink-soft">직원
          <select name="staff_id" defaultValue={defaults?.staff_id} className="field mt-1">
            {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">날짜
          <input name="work_date" type="date" defaultValue={defaults?.work_date} className="field mt-1" required />
        </label>
        <label className="text-xs text-ink-soft">출근
          <input name="clock_in" type="time" defaultValue={defaults?.clock_in} className="field mt-1" />
        </label>
        <label className="text-xs text-ink-soft">퇴근
          <input name="clock_out" type="time" defaultValue={defaults?.clock_out} className="field mt-1" />
        </label>
        <label className="text-xs text-ink-soft">메모
          <input name="note" defaultValue={defaults?.note} className="field mt-1" />
        </label>
        <label className="text-xs text-ink-soft">수정 사유
          <input name="reason" className="field mt-1" required placeholder="예: 출근 버튼 누락" />
        </label>
      </div>
      <button className="btn btn-ghost" disabled={pending}>{pending ? "저장 중…" : "근태 기록 저장"}</button>
      <p className="text-xs text-ink-soft">지각·조퇴는 근무 설정 기준으로 다시 판정하고, 바꾼 내용은 이력에 남습니다.</p>
      <Message state={state} />
    </form>
  );
}

export function BalanceForm({ action, staffId, year, granted, adjustment }: { action: Action; staffId: string; year: number; granted: number; adjustment: number }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="staff_id" value={staffId} />
      <input type="hidden" name="year" value={year} />
      <input name="granted" defaultValue={granted} inputMode="decimal" className="field !w-16 !py-1 text-right text-xs" aria-label="부여" />
      <span className="text-xs text-ink-soft">+</span>
      <input name="adjustment" defaultValue={adjustment} inputMode="decimal" className="field !w-16 !py-1 text-right text-xs" aria-label="조정" />
      <input name="note" placeholder="바꾼 이유" className="field !w-28 !py-1 text-xs" aria-label="바꾼 이유" />
      <button className="btn btn-ghost !px-2 !py-1 text-xs" disabled={pending}>{pending ? "…" : "저장"}</button>
      <Message state={state} />
    </form>
  );
}

export function SettingsForm({ action, settings }: { action: Action; settings: { setting_key: string; setting_label: string; setting_value: string }[] }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {settings.map((x) => (
          <label key={x.setting_key} className="text-xs text-ink-soft">{x.setting_label}
            <input name={`set:${x.setting_key}`} defaultValue={x.setting_value} className="field mt-1 tabular-nums" />
          </label>
        ))}
      </div>
      <button className="btn" disabled={pending}>{pending ? "저장 중…" : "근무 설정 저장"}</button>
      <Message state={state} />
    </form>
  );
}

export function HolidayForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-ink-soft">날짜
        <input name="holiday_date" type="date" className="field mt-1" required />
      </label>
      <label className="text-xs text-ink-soft">이름
        <input name="holiday_name" placeholder="예: 창립기념일" className="field mt-1" required />
      </label>
      <button className="btn btn-ghost" disabled={pending}>{pending ? "…" : "휴일 추가"}</button>
      <Message state={state} />
    </form>
  );
}

export type HrRow = {
  staff_id: string;
  name: string;
  join_date: string | null;
  birthday_month: number | null;
  birthday_day: number | null;
  work_type: string;
  leave_grant_mode: string;
  work_phone: string | null;
};

export function HrForm({ action, row }: { action: Action; row: HrRow }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-[7rem_9rem_8rem_8rem_12rem_9rem_auto]">
      <input type="hidden" name="staff_id" value={row.staff_id} />
      <p className="text-sm font-semibold">{row.name}</p>
      <label className="text-xs text-ink-soft">입사일
        <input name="join_date" type="date" defaultValue={row.join_date ?? ""} className="field mt-1" />
      </label>
      <label className="text-xs text-ink-soft">생일 (월 / 일)
        <span className="mt-1 flex gap-1">
          <input name="birthday_month" defaultValue={row.birthday_month ?? ""} inputMode="numeric" className="field !px-2" aria-label="생일 월" />
          <input name="birthday_day" defaultValue={row.birthday_day ?? ""} inputMode="numeric" className="field !px-2" aria-label="생일 일" />
        </span>
      </label>
      <label className="text-xs text-ink-soft">근무 유형
        <select name="work_type" defaultValue={row.work_type} className="field mt-1">
          {Object.entries(WORK_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-xs text-ink-soft">연차 부여 방식
        <select name="leave_grant_mode" defaultValue={row.leave_grant_mode} className="field mt-1">
          {Object.entries(GRANT_MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-xs text-ink-soft">업무폰
        <input name="work_phone" defaultValue={row.work_phone ?? ""} className="field mt-1" />
      </label>
      <div className="space-y-1">
        <button className="btn btn-ghost !px-3 !py-2 text-xs" disabled={pending}>{pending ? "…" : "저장"}</button>
        <Message state={state} />
      </div>
    </form>
  );
}

export function ImportForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <button className="btn" disabled={pending}>{pending ? "옮기는 중…" : "예전 대시보드 근태 가져오기"}</button>
      <Message state={state} />
    </form>
  );
}
