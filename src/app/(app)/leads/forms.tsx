"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { CONTACT_TYPES, formatKST, LEAD_STATUSES, MEDIA, normalizeCompany, parseInquiryAt, phoneDigits, SOURCES } from "@/lib/leads";
import type { FormState } from "./actions";

type Action = (prev: FormState, f: FormData) => Promise<FormState>;

export function Message({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

export type LeadValues = {
  inquiry_at?: string;
  company_name?: string;
  contact_name?: string | null;
  phone?: string | null;
  monthly_budget?: number | null;
  source?: string | null;
  media?: string[];
  inquiry_content?: string | null;
  memo?: string | null;
  next_contact_on?: string | null;
};

export type DupCandidate = { id: string; company_name: string; phone_digits: string | null; inquiry_at: string; status: string; kind: "lead" | "client" };

export function LeadForm({
  action,
  initial = {},
  submitLabel,
  readOnly = false,
  staff,
  canAssign,
  isNew,
  candidates = [],
  selfId,
}: {
  action: Action;
  initial?: LeadValues;
  submitLabel: string;
  readOnly?: boolean;
  staff?: { id: string; name: string }[];
  canAssign?: boolean;
  isNew?: boolean;
  candidates?: DupCandidate[];
  selfId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [when, setWhen] = useState(initial.inquiry_at ? formatKST(initial.inquiry_at) : "");
  const [company, setCompany] = useState(initial.company_name ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [budget, setBudget] = useState(initial.monthly_budget ? initial.monthly_budget.toLocaleString("ko-KR") : "");
  const parsed = when ? parseInquiryAt(when) : null;
  const sources = initial.source && !SOURCES.includes(initial.source) ? [...SOURCES, initial.source] : SOURCES;
  const media = initial.media ?? [];

  // 같은 연락처·비슷한 업체명이 이미 있으면 알려줌
  const dups = useMemo(() => {
    const p = phoneDigits(phone);
    const n = normalizeCompany(company);
    if (p.length < 8 && n.length < 2) return [];
    return candidates
      .filter((c) => (p.length >= 8 && c.phone_digits === p) || (n.length >= 2 && normalizeCompany(c.company_name) === n))
      .slice(0, 5);
  }, [phone, company, candidates]);

  return (
    <form action={formAction} className="space-y-5">
      <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="label" htmlFor="inquiry_at">문의시간 * (알림 문구를 그대로 붙여 넣어도 됩니다)</label>
          <div className="flex gap-2">
            <input id="inquiry_at" name="inquiry_at" required value={when} onChange={(e) => setWhen(e.target.value)} placeholder="예: 2026년 10월 7일 화요일 14:30" className="field" />
            {!readOnly && (
              <button type="button" className="btn btn-ghost px-3 text-xs" onClick={() => setWhen(formatKST(new Date().toISOString()))}>지금</button>
            )}
          </div>
          <p className={`mt-1 text-xs ${when && !parsed ? "text-danger" : "text-ink-soft"}`}>
            {when ? (parsed ? `인식됨 · ${formatKST(parsed)}` : "날짜·시간을 읽지 못했습니다. 예: 2026-10-07 14:30") : ""}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="company_name">업체명 *</label>
          <input id="company_name" name="company_name" required value={company} onChange={(e) => setCompany(e.target.value)} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="contact_name">업체 담당자</label>
          <input id="contact_name" name="contact_name" defaultValue={initial.contact_name ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="phone">연락처</label>
          <input id="phone" name="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="monthly_budget">월 광고예산 (원)</label>
          <input
            id="monthly_budget"
            name="monthly_budget"
            inputMode="numeric"
            value={budget}
            onChange={(e) => {
              const d = e.target.value.replace(/[^\d]/g, "");
              setBudget(d ? Number(d).toLocaleString("ko-KR") : "");
            }}
            className="field text-right tabular-nums"
          />
        </div>
        {dups.length > 0 && (
          <div className="rounded-xl border border-[var(--warn-ink)]/30 bg-[var(--warn-bg)] p-3 text-sm md:col-span-2">
            <p className="font-semibold text-[var(--warn-ink)]">이미 등록된 것 같습니다. 확인해 주세요.</p>
            <ul className="mt-1 space-y-0.5">
              {dups.map((d) => (
                <li key={d.kind + d.id}>
                  <Link href={d.kind === "lead" ? `/leads/${d.id}` : `/clients/${d.id}`} target="_blank" className="underline">
                    {d.kind === "lead" ? "문의" : "거래처"} · {d.company_name}
                  </Link>
                  {d.kind === "lead" && <span className="text-ink-soft"> · {d.inquiry_at.slice(0, 10)} · {d.status}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <label className="label" htmlFor="source">유입경로</label>
          <select id="source" name="source" defaultValue={initial.source ?? ""} className="field">
            <option value="">선택 안 함</option>
            {sources.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        {isNew && staff && (
          <div>
            <label className="label" htmlFor="staff_id">담당</label>
            <select id="staff_id" name="staff_id" defaultValue="" className="field">
              <option value="">미배정 (나중에 지정)</option>
              {canAssign ? staff.map((x) => <option key={x.id} value={x.id}>{x.name}{x.id === selfId ? " (나)" : ""}</option>) : <option value="me">내가 담당</option>}
            </select>
          </div>
        )}
        <div className="md:col-span-2">
          <span className="label">광고 매체</span>
          <div className="flex flex-wrap gap-4 pt-1 text-sm">
            {MEDIA.map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="checkbox" name="media" value={m} defaultChecked={media.includes(m)} /> {m}
              </label>
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="inquiry_content">문의 내용</label>
          <textarea id="inquiry_content" name="inquiry_content" rows={3} defaultValue={initial.inquiry_content ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="memo">비고</label>
          <input id="memo" name="memo" defaultValue={initial.memo ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="next_contact_on">다음 연락 예정일</label>
          <input id="next_contact_on" name="next_contact_on" type="date" defaultValue={initial.next_contact_on ?? ""} className="field" />
        </div>
      </fieldset>
      <Message state={state} />
      {!readOnly && <button className="btn" disabled={pending || (!!when && !parsed)}>{pending ? "저장 중…" : submitLabel}</button>}
    </form>
  );
}

export function StatusForm({ action, status, nextOn }: { action: Action; status: string; nextOn: string | null }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select name="status" defaultValue={status} className="field" aria-label="진행 상태">
          {LEAD_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <input type="date" name="next_contact_on" defaultValue={nextOn ?? ""} className="field" aria-label="다음 연락 예정일" />
      </div>
      <button className="btn btn-ghost w-full" disabled={pending}>{pending ? "…" : "상태·예정일 저장"}</button>
      <Message state={state} />
    </form>
  );
}

export function OwnerForm({ action, staff, current, canAssign, selfId }: { action: Action; staff: { id: string; name: string }[]; current: string | null; canAssign: boolean; selfId: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  if (!canAssign) {
    if (current) return null;
    return (
      <form action={formAction} className="space-y-1">
        <input type="hidden" name="staff_id" value={selfId} />
        <button className="btn w-full" disabled={pending}>내가 담당하기</button>
        <Message state={state} />
      </form>
    );
  }
  return (
    <form action={formAction} className="space-y-2">
      <select name="staff_id" defaultValue={current ?? ""} className="field" aria-label="담당">
        <option value="">미배정</option>
        {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <button className="btn btn-ghost w-full" disabled={pending}>{pending ? "…" : "담당 저장"}</button>
      <Message state={state} />
    </form>
  );
}

export function ActivityForm({ action, status }: { action: Action; status: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select name="activity_type" defaultValue="전화" className="field" aria-label="연락 방법">
          {CONTACT_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <input type="datetime-local" name="occurred_at" className="field" aria-label="연락 일시 (비우면 지금)" />
      </div>
      <textarea name="content" rows={3} required placeholder="상담 결과와 다음 할 일" className="field" />
      <div className="grid grid-cols-2 gap-2">
        <select name="status" defaultValue="" className="field" aria-label="상태도 바꾸기">
          <option value="">상태 그대로 ({status})</option>
          {LEAD_STATUSES.filter((x) => x !== status).map((x) => <option key={x} value={x}>→ {x}</option>)}
        </select>
        <input type="date" name="next_contact_on" className="field" aria-label="다음 연락 예정일" />
      </div>
      <p className="text-xs text-ink-soft">다음 연락 예정일을 비워 두면 예정일이 지워지고, 마지막 연락 후 3영업일 기준으로 알려 줍니다.</p>
      <button className="btn w-full" disabled={pending}>{pending ? "…" : "상담 기록 남기기"}</button>
      <Message state={state} />
    </form>
  );
}

export function ClientLinkForm({ action, clients, suggested }: { action: Action; clients: { id: string; company_name: string }[]; suggested: string | null }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <select name="client_id" defaultValue={suggested ?? "new"} className="field" aria-label="거래처">
        <option value="new">+ 이 문의로 새 거래처 만들기</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
      </select>
      <button className="btn btn-ghost w-full" disabled={pending}>{pending ? "…" : "거래처 연결"}</button>
      <Message state={state} />
    </form>
  );
}
