"use client";

import { useActionState } from "react";
import type { FormState } from "../actions";

export function ImportForm({ action, pending: count }: { action: (p: FormState, f: FormData) => Promise<FormState>; pending: number }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <button className="btn" disabled={pending || count === 0}>{pending ? "옮기는 중…" : count ? `새 문의 ${count}건 옮기기` : "옮길 새 문의 없음"}</button>
      {state.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      {state.ok && <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>}
    </form>
  );
}
