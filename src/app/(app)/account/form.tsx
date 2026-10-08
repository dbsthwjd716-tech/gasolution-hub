"use client";

import { useActionState } from "react";
import { changePassword } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, { error: "" });
  return (
    <form action={action} className="space-y-3">
      <label className="label">새 비밀번호 (8자 이상)<input type="password" name="password" autoComplete="new-password" className="field mt-1" required /></label>
      <label className="label">한 번 더<input type="password" name="again" autoComplete="new-password" className="field mt-1" required /></label>
      <button className="btn" disabled={pending}>{pending ? "바꾸는 중…" : "비밀번호 변경"}</button>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>}
    </form>
  );
}
