"use client";

import { useActionState } from "react";
import { refreshBizmoney, type RefreshState } from "./actions";

// 비즈머니 지금 새로고침 (전 광고주 다시 확인, 1~2분)
export function RefreshBizmoney() {
  const [state, action, pending] = useActionState<RefreshState, FormData>(refreshBizmoney, { error: "" });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <button className="btn btn-ghost" disabled={pending} title="네이버에서 비즈머니와 이번 달 소진을 지금 다시 확인합니다">
        {pending ? "확인 중… (보통 30초 안)" : "↻ 지금 새로고침"}
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
      {state.ok && !pending && <span className="text-xs text-[var(--ok-ink)]">{state.ok}</span>}
    </form>
  );
}
