"use client";

import { useActionState, useState } from "react";
import type { FormState } from "./actions";
import { Message } from "./forms";

type Action = (prev: FormState, f: FormData) => Promise<FormState>;

export function StepButton({ action, step, label, ghost = false, danger = false, confirmText }: { action: Action; step: string; label: string; ghost?: boolean; danger?: boolean; confirmText?: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} onSubmit={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }} className="space-y-1">
      <input type="hidden" name="step" value={step} />
      <button className={`btn w-full ${ghost ? "btn-ghost" : ""} ${danger ? "text-danger" : ""}`} disabled={pending}>{pending ? "…" : label}</button>
      <Message state={state} />
    </form>
  );
}

export function RejectForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="step" value="reject" />
      <input name="reason" placeholder="반려 사유 (담당자에게 보임)" className="field" />
      <button className="btn btn-ghost w-full text-danger" disabled={pending}>반려</button>
      <Message state={state} />
    </form>
  );
}

export function PaymentForm({ action, received, paidAt, readOnly }: { action: Action; received: boolean; paidAt: string | null; readOnly: boolean }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [on, setOn] = useState(received);
  return (
    <form action={formAction} className="space-y-2">
      <fieldset disabled={readOnly} className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="payment_received" checked={on} onChange={(e) => setOn(e.target.checked)} /> 입금 확인
        </label>
        {on && <input type="date" name="paid_at" defaultValue={paidAt ?? ""} className="field w-40" aria-label="입금일" />}
        {!readOnly && <button className="btn btn-ghost" disabled={pending}>저장</button>}
      </fieldset>
      <Message state={state} />
    </form>
  );
}

export function CopyButton({ text, label = "발행요청 문구 복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost w-full"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          window.prompt("아래 내용을 복사해 주세요", text);
        }
      }}
    >
      {done ? "복사했습니다" : label}
    </button>
  );
}

export function ConfirmSubmit({ action, label, confirmText }: { action: () => Promise<void>; label: string; confirmText: string }) {
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(confirmText)) e.preventDefault(); }}>
      <button className="text-xs text-danger underline">{label}</button>
    </form>
  );
}
