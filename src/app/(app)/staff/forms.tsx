"use client";

import { useActionState, useState } from "react";
import type { FormState } from "./actions";

type Action = (p: FormState, f: FormData) => Promise<FormState>;

function Msg({ state }: { state: FormState }) {
  if (state.error) return <p className="text-xs text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-xs text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

export function AddStaffForm({ action, ceo }: { action: Action; ceo: boolean }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      <input name="name" placeholder="이름" className="field" required aria-label="이름" />
      <input name="email" type="email" placeholder="이메일 (로그인 아이디)" className="field lg:col-span-2" required aria-label="이메일" />
      <label className="flex items-center gap-2 text-xs text-ink-soft">입사일<input type="date" name="join_date" className="field" /></label>
      {ceo ? (
        <select name="role" defaultValue="staff" className="field" aria-label="역할">
          <option value="staff">직원</option>
          <option value="lead">팀장</option>
          <option value="ceo">대표</option>
        </select>
      ) : <input type="hidden" name="role" value="staff" />}
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-5">
        <button className="btn" disabled={pending}>{pending ? "등록 중…" : "직원 등록"}</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function JoinDateForm({ action, value }: { action: Action; value: string | null }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="date" name="join_date" defaultValue={value ?? ""} className="field !w-36 !py-1 text-xs" aria-label="입사일" />
      <button className="text-xs text-brand hover:underline" disabled={pending}>저장</button>
      {state.error ? <span className="text-[11px] text-danger">{state.error}</span> : state.ok ? <span className="text-[11px] text-[var(--ok-ink)]">✓</span> : null}
    </form>
  );
}

// 임시 비밀번호는 이 화면에서 한 번만 보여 줌 (저장하지 않음)
export function CreateLoginButton({ action, label = "로그인 계정 만들기", confirmText }: { action: Action; label?: string; confirmText?: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [copied, setCopied] = useState(false);
  if (state.password) {
    return (
      <div className="rounded-lg border border-[#cddcff] bg-brand-soft p-2 text-xs">
        <p>{state.ok}</p>
        <p className="mt-1">임시 비밀번호 <b className="font-mono text-sm">{state.password}</b>
          <button type="button" className="ml-2 text-brand underline" onClick={() => navigator.clipboard.writeText(state.password!).then(() => setCopied(true))}>{copied ? "복사됨" : "복사"}</button>
        </p>
        <p className="mt-1 text-ink-soft">지금만 보입니다. 직원에게 직접 전달하고, 첫 로그인 뒤 메뉴 아래 「비밀번호」에서 바꾸도록 안내해 주세요.</p>
      </div>
    );
  }
  return (
    <form action={formAction} className="inline" onSubmit={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }}>
      <button className="text-xs font-semibold text-brand hover:underline disabled:text-ink-soft" disabled={pending}>{pending ? "처리 중…" : label}</button>
      {state.error && <span className="ml-2 text-[11px] text-danger">{state.error}</span>}
    </form>
  );
}

// 로그인 칸: 계정을 만든 직후 화면이 새로 그려져도(있음으로 바뀌어도) 임시 비밀번호가 사라지지 않게 한 덩어리로 둠
export function LoginCell({ hasLogin, canCreate, canReset, create, reset, name, noRightText }: {
  hasLogin: boolean; canCreate: boolean; canReset: boolean; create: Action; reset: Action; name: string; noRightText: string;
}) {
  const [cState, cAction, cPending] = useActionState(create, { error: "" });
  const [rState, rAction, rPending] = useActionState(reset, { error: "" });
  const [copied, setCopied] = useState(false);
  const shown = rState.password ? rState : cState.password ? cState : null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {hasLogin && <span className="chip chip-ok">있음</span>}
      {shown ? (
        <span className="block rounded-lg border border-[#cddcff] bg-brand-soft p-2 text-xs">
          <span className="block">{shown.ok}</span>
          <span className="mt-1 block">임시 비밀번호 <b className="font-mono text-sm">{shown.password}</b>
            <button type="button" className="ml-2 text-brand underline" onClick={() => navigator.clipboard.writeText(shown.password!).then(() => setCopied(true))}>{copied ? "복사됨" : "복사"}</button>
          </span>
          <span className="mt-1 block text-ink-soft">지금만 보입니다. 본인에게 직접 전달하고, 첫 로그인 뒤 메뉴 아래 「비밀번호」에서 바꾸도록 안내해 주세요.</span>
        </span>
      ) : hasLogin ? (
        canReset && (
          <form action={rAction} className="inline" onSubmit={(e) => { if (!window.confirm(`${name}님 비밀번호를 새 임시 비밀번호로 바꿀까요?`)) e.preventDefault(); }}>
            <button className="text-xs font-semibold text-brand hover:underline disabled:text-ink-soft" disabled={rPending}>{rPending ? "처리 중…" : "비밀번호 초기화"}</button>
            {rState.error && <span className="ml-2 text-[11px] text-danger">{rState.error}</span>}
          </form>
        )
      ) : canCreate ? (
        <form action={cAction} className="inline">
          <button className="text-xs font-semibold text-brand hover:underline disabled:text-ink-soft" disabled={cPending}>{cPending ? "처리 중…" : "로그인 계정 만들기"}</button>
          {cState.error && <span className="ml-2 text-[11px] text-danger">{cState.error}</span>}
        </form>
      ) : (
        <span className="text-xs text-ink-soft">{noRightText}</span>
      )}
    </span>
  );
}
