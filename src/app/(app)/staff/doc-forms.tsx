"use client";

import { useActionState, useState } from "react";
import { FileUpload } from "@/components/file-upload";
import { DOC_KINDS, STAFF_DOC_BUCKET } from "@/lib/staff-docs";
import type { DocState } from "./doc-actions";

type Action = (p: DocState, f: FormData) => Promise<DocState>;

export function DocUploadForm({ action, staffId, defaultKind = "contract", kinds }: { action: Action; staffId: string; defaultKind?: string; kinds?: string[] }) {
  // 등록에 성공할 때마다 n이 늘어 → 양식(올린 파일 목록 포함)을 새로 그림
  const [state, formAction, pending] = useActionState(async (p: DocState & { n: number }, f: FormData) => {
    const r = await action(p, f);
    return { ...r, n: p.n + (r.ok ? 1 : 0) };
  }, { error: "", n: 0 });
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState(defaultKind);
  const list = DOC_KINDS.filter((k) => !kinds || kinds.includes(k.key));
  return (
    <form key={state.n} action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm font-semibold">
          서류 종류
          <select name="kind" className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            {list.map((k) => <option key={k.key} value={k.key}>{k.label}{k.when ? ` (${k.when})` : ""}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          {kind === "certificate" ? "자격증 이름" : "제목 (선택)"}
          <input name="title" className="field" placeholder={kind === "certificate" ? "예: 검색광고마케터 1급" : ""} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          {kind === "certificate" ? "취득일" : kind === "resignation" ? "퇴사일" : "작성·발급일 (선택)"}
          <input type="date" name="issued_on" className="field" />
        </label>
      </div>
      <FileUpload name="files" folder={staffId} bucket={STAFF_DOC_BUCKET} onBusyChange={setBusy} hint="PDF·사진(JPG·PNG), 한 파일 20MB까지. 여러 개 함께 올릴 수 있습니다." />
      <label className="block space-y-1 text-sm font-semibold">
        메모 (선택)
        <input name="note" className="field" />
      </label>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={busy || pending}>{pending ? "등록 중…" : "서류 등록"}</button>
        {state.error && <span className="text-sm text-danger">{state.error}</span>}
        {state.ok && <span className="text-sm text-[var(--ok-ink)]">{state.ok}</span>}
      </div>
    </form>
  );
}
