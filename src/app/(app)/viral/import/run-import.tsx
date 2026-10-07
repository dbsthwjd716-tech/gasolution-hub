"use client";

import Link from "next/link";
import { useActionState } from "react";
import { runViralImport, type ImportResult } from "../actions";

export function RunImport() {
  const [state, action, pending] = useActionState<ImportResult, FormData>(runViralImport, { error: "" });
  return (
    <section className="glass p-5">
      {state.done ? (
        <div className="space-y-2 text-sm">
          <p className="font-bold text-[var(--ok-ink)]">옮기기를 마쳤습니다.</p>
          <p>바이럴 {state.done.ordersSaved}건 저장 · 거래처 새로 만듦 {state.done.clientsCreated}곳 · 기존 거래처에 연결 {state.done.clientsMatched}곳</p>
          {state.done.unknownManagers.length > 0 && (
            <p className="text-[var(--warn-ink)]">
              직원 목록에 없는 담당자 이름: {state.done.unknownManagers.join(", ")} — 해당 건은 담당 미지정으로 두고 메모에 이름을 남겼습니다.
            </p>
          )}
          <Link href="/viral?m=all" className="btn mt-2">바이럴 목록 보기</Link>
        </div>
      ) : (
        <form action={action} className="space-y-3">
          <p className="text-sm">위 내용대로 옮길까요? 시트를 다시 읽어서 그 시점 내용으로 옮깁니다.</p>
          {state.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
          <button className="btn" disabled={pending}>{pending ? "옮기는 중… (1~2분 걸릴 수 있습니다)" : "이대로 옮기기"}</button>
        </form>
      )}
    </section>
  );
}
