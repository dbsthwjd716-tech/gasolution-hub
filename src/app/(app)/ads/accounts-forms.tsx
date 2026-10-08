"use client";

import { useActionState, useState } from "react";
import type { AccForm } from "./accounts-actions";

type Action = (p: AccForm, f: FormData) => Promise<AccForm>;
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

function Msg({ s }: { s: AccForm }) {
  if (s.error) return <p className="text-sm text-danger" role="alert">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-[var(--ok-ink)]">{s.ok}</p>;
  return null;
}

export function UploadForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept=".csv,text/csv" className="field !w-auto" required aria-label="유상실적 CSV 파일" />
        <button className="btn" disabled={pending}>{pending ? "올리는 중… (잠시만요)" : "유상실적 업로드"}</button>
      </div>
      <Msg s={state} />
    </form>
  );
}

export function AddAccountForm({ action, groups, employees }: { action: Action; groups: { id: number; name: string }[]; employees: { id: number; name: string; has_credential: boolean }[] }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [type, setType] = useState("SA");
  const [group, setGroup] = useState("");
  const [source, setSource] = useState("auto");
  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {[["SA", "네이버 검색광고 (통합 계정 포함)"], ["GFA", "네이버 GFA 전용 (성과형)"], ["META", "메타"]].map(([v, l]) => (
          <label key={v} className="cursor-pointer">
            <input type="radio" name="type" value={v} checked={type === v} onChange={() => setType(v)} className="peer sr-only" />
            <span className="inline-block rounded-lg border border-[#dbe3ee] px-3 py-1.5 text-sm peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white">{l}</span>
          </label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-ink-soft">광고주명 *<input name="name" className="field mt-1" required placeholder="예: frim885-프라임파크골프-통합 계정" /></label>
        {type === "SA" && <label className="text-xs text-ink-soft">Customer ID *<input name="customer_id" inputMode="numeric" className="field mt-1" required placeholder="숫자" /></label>}
        {type !== "META" && <label className="text-xs text-ink-soft">GFA Account ID {type === "GFA" ? "*" : "(있으면)"}<input name="gfa_no" inputMode="numeric" className="field mt-1" required={type === "GFA"} placeholder="숫자" /></label>}
        {type === "META" && <label className="text-xs text-ink-soft">Meta 광고계정 ID *<input name="meta_id" className="field mt-1" required placeholder="act_123… 또는 숫자" /></label>}
        <label className="text-xs text-ink-soft">담당자 *
          <select name="manager" className="field mt-1" required defaultValue="">
            <option value="" disabled>고르기</option>
            {employees.map((e) => <option key={e.id} value={e.name} disabled={type !== "META" && !e.has_credential}>{e.name}{type !== "META" && !e.has_credential ? " (네이버 API 그룹 없음)" : ""}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">광고주 그룹 *
          <select name="group_id" value={group} onChange={(e) => setGroup(e.target.value)} className="field mt-1" required>
            <option value="" disabled>고르기</option>
            <option value="new">+ 새 그룹 만들기</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        {group === "new" && <label className="text-xs text-ink-soft">새 그룹 이름 *<input name="new_group" className="field mt-1" required placeholder="보통 거래처(브랜드) 이름" /></label>}
        <label className="text-xs text-ink-soft">매핑일 (맡은 날)<input type="date" name="mapped_at" defaultValue={today()} className="field mt-1" /></label>
        {type === "META" && <label className="text-xs text-ink-soft">담당 시작일<input type="date" name="meta_from" defaultValue={today()} className="field mt-1" /></label>}
        {type === "SA" && (
          <label className="text-xs text-ink-soft">실적 기준
            <select name="adcost_source" value={source} onChange={(e) => setSource(e.target.value)} className="field mt-1">
              <option value="auto">자동 (네이버 API, 안 되면 유상실적)</option>
              <option value="naver_api">네이버 API만</option>
              <option value="transferred">피이관 (유상실적 파일 기준)</option>
            </select>
          </label>
        )}
        {type === "SA" && source === "transferred" && <label className="text-xs text-ink-soft">피이관 시작일 *<input type="date" name="transferred_at" className="field mt-1" required /></label>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "등록 중…" : "광고주 등록"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function EditAccountForm({ action, groups, source, transferredAt, groupId }: { action: Action; groups: { id: number; name: string }[]; source: string; transferredAt: string | null; groupId: number | null }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [src, setSrc] = useState(source);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg bg-[#f6f8fc] p-3">
      <label className="text-xs text-ink-soft">실적 기준
        <select name="adcost_source" value={src} onChange={(e) => setSrc(e.target.value)} className="field mt-1 !w-auto !py-1.5 text-xs">
          <option value="auto">자동</option>
          <option value="naver_api">네이버 API만</option>
          <option value="transferred">피이관</option>
        </select>
      </label>
      {src === "transferred" && <label className="text-xs text-ink-soft">피이관 시작일<input type="date" name="transferred_at" defaultValue={transferredAt ?? ""} className="field mt-1 !w-auto !py-1.5 text-xs" required /></label>}
      <label className="text-xs text-ink-soft">그룹
        <select name="group_id" defaultValue={groupId ?? ""} className="field mt-1 !w-auto !py-1.5 text-xs">
          <option value="">그대로</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      <button className="btn btn-ghost !px-3 !py-1.5 text-xs" disabled={pending}>{pending ? "…" : "저장"}</button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
      {state.ok && <span className="text-xs text-[var(--ok-ink)]">{state.ok}</span>}
    </form>
  );
}
