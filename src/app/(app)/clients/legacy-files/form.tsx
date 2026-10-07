"use client";

import { useActionState } from "react";
import type { CopyState } from "./actions";

export function CopyForm({ action }: { action: (p: CopyState, f: FormData) => Promise<CopyState> }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <button className="btn" disabled={pending}>{pending ? "복사 중…" : "파일 복사하기"}</button>
      {state.ok && <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>}
      {state.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      {state.failed?.length ? <ul className="text-xs text-danger">{state.failed.map((f) => <li key={f}>{f}</li>)}</ul> : null}
    </form>
  );
}
