"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, { error: "" });
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={action} className="glass w-full max-w-sm space-y-5 p-8">
        <div>
          <p className="text-xs font-semibold tracking-wide text-brand">GA SOLUTION</p>
          <h1 className="mt-1 text-xl font-bold">통합 시스템 로그인</h1>
        </div>
        <div>
          <label className="label" htmlFor="email">이메일</label>
          <input id="email" name="email" type="email" required autoComplete="email" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="field" />
        </div>
        {state.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
        <button className="btn w-full" disabled={pending}>
          {pending ? "확인 중…" : "로그인"}
        </button>
        <p className="text-xs text-ink-soft">계정은 대표가 직접 만들어 드립니다.</p>
      </form>
    </main>
  );
}
