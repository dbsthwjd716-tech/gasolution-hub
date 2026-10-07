"use client";

import { useActionState, useMemo, useState } from "react";
import { FileUpload } from "@/components/file-upload";
import type { FormState } from "./actions";

type Action = (p: FormState, f: FormData) => Promise<FormState>;
const won = (n: number) => n.toLocaleString("ko-KR");
const FOLDER = "viral/statements";

function Message({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

export type StatementValues = {
  partner_id: string;
  period_start: string;
  period_end: string;
  title: string | null;
  amount: number;
  memo: string | null;
  paid_on?: string | null;
  invoice_done_on?: string | null;
  paid?: boolean;
  invoice_done?: boolean;
};

// 견적서 등록·수정: 협력사 / 기간 / 이름 / 금액(VAT 포함) / 파일
export function StatementForm({ action, partners, initial, submitLabel, withFiles = true }: {
  action: Action;
  partners: { id: string; name: string }[];
  initial?: StatementValues;
  submitLabel: string;
  withFiles?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(initial?.amount ? won(initial.amount) : "");
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.3fr_1fr]">
        <label className="text-xs text-ink-soft">협력사
          <select name="partner_id" defaultValue={initial?.partner_id ?? ""} className="field mt-1" required>
            <option value="">골라 주세요</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">기간 시작
          <input name="period_start" type="date" defaultValue={initial?.period_start ?? ""} className="field mt-1" required />
        </label>
        <label className="text-xs text-ink-soft">기간 끝
          <input name="period_end" type="date" defaultValue={initial?.period_end ?? ""} className="field mt-1" required />
        </label>
        <label className="text-xs text-ink-soft">이름 (선택)
          <input name="title" defaultValue={initial?.title ?? ""} placeholder="예: 10월 1주차" className="field mt-1" />
        </label>
        <label className="text-xs text-ink-soft">견적 금액 (VAT 포함)
          <input
            name="amount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, "") ? won(Number(e.target.value.replace(/[^\d]/g, ""))) : "")}
            placeholder="0"
            className="field mt-1 text-right tabular-nums"
          />
        </label>
      </div>
      {initial && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink-soft">협력사 입금일 {initial.paid ? "" : "(입금 체크 후 입력)"}
            <input name="paid_on" type="date" defaultValue={initial.paid_on ?? ""} disabled={!initial.paid} className="field mt-1" />
          </label>
          <label className="text-xs text-ink-soft">세금계산서 발행일 {initial.invoice_done ? "" : "(발행 체크 후 입력)"}
            <input name="invoice_done_on" type="date" defaultValue={initial.invoice_done_on ?? ""} disabled={!initial.invoice_done} className="field mt-1" />
          </label>
        </div>
      )}
      <input name="memo" defaultValue={initial?.memo ?? ""} placeholder="메모 (선택)" className="field" aria-label="메모" />
      {withFiles && (
        <FileUpload
          name="files"
          folder={FOLDER}
          accept="application/pdf,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,.xlsx,.xls,.csv"
          hint="협력사가 보낸 견적서 (PDF·이미지·엑셀, 20MB까지)"
          onBusyChange={setBusy}
        />
      )}
      <button className="btn" disabled={pending || busy}>{pending ? "저장 중…" : submitLabel}</button>
      <Message state={state} />
    </form>
  );
}

export function StatementFilesForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <form action={formAction} className="space-y-2">
      <FileUpload
        name="files"
        folder={FOLDER}
        accept="application/pdf,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,.xlsx,.xls,.csv"
        onBusyChange={setBusy}
        onChange={(f) => setCount(f.length)}
      />
      {count > 0 && <button className="btn btn-ghost w-full" disabled={pending || busy}>{pending ? "…" : `파일 ${count}개 저장`}</button>}
      <Message state={state} />
    </form>
  );
}

export type LinkRow = {
  id: string;
  paid_date: string | null;
  company_name: string;
  description: string | null;
  staff_name: string | null;
  cost_amount: number | null;
  sale_amount: number;
  partner_paid: boolean;
  invoice_label: string;
  linked_here: boolean;
  linked_elsewhere: string | null; // 다른 견적서 이름
};

// 이 견적서에 들어 있는 바이럴 건 체크 → 공급가 합계를 견적 금액과 비교
export function LinkOrdersForm({ action, rows, statementAmount }: { action: Action; rows: LinkRow[]; statementAmount: number }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [picked, setPicked] = useState(() => new Set(rows.filter((r) => r.linked_here).map((r) => r.id)));
  const sum = useMemo(() => rows.filter((r) => picked.has(r.id)).reduce((t, r) => t + (r.cost_amount ?? 0), 0), [rows, picked]);
  const diff = statementAmount - sum;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <form action={formAction} className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr>
              <th className="w-8 py-1"></th><th>입금일</th><th>업체</th><th>상품</th><th>담당</th>
              <th className="text-right">공급가(VAT포함)</th><th className="text-right">판매가(VAT별도)</th><th>협력사 결제</th><th>세금계산서</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-[var(--glass-border)] ${picked.has(r.id) ? "bg-[var(--brand-soft,rgba(80,120,255,0.06))]" : ""}`}>
                <td className="py-1.5">
                  <input type="checkbox" name="order_id" value={r.id} checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`${r.company_name} 연결`} />
                </td>
                <td className="whitespace-nowrap tabular-nums">{r.paid_date ?? "-"}</td>
                <td className="whitespace-nowrap">
                  <a href={`/viral/${r.id}`} className="hover:text-brand hover:underline">{r.company_name}</a>
                  {r.linked_elsewhere && !picked.has(r.id) && <span className="ml-1 chip chip-muted">{r.linked_elsewhere}에 연결됨</span>}
                </td>
                <td className="max-w-[260px] truncate" title={r.description ?? ""}>{r.description ?? "-"}</td>
                <td className="whitespace-nowrap">{r.staff_name ?? "-"}</td>
                <td className="text-right tabular-nums">{r.cost_amount == null ? "-" : won(r.cost_amount)}</td>
                <td className="text-right tabular-nums">{won(r.sale_amount)}</td>
                <td className="whitespace-nowrap">{r.partner_paid ? <span className="chip chip-ok">완료</span> : <span className="chip chip-warn">미결제</span>}</td>
                <td className="whitespace-nowrap">{r.invoice_label}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="py-3 text-ink-soft">이 기간에 해당 협력사 바이럴 건이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>선택 {picked.size}건 · 공급가 합계 <b className="tabular-nums">{won(sum)}원</b></span>
        <span className={diff === 0 ? "text-[var(--ok-ink)]" : "text-[var(--warn-ink)]"}>
          {diff === 0 ? "견적 금액과 같습니다" : `견적 금액과 ${won(Math.abs(diff))}원 ${diff > 0 ? "부족" : "초과"}`}
        </span>
        <button className="btn ml-auto" disabled={pending}>{pending ? "…" : "연결 저장"}</button>
      </div>
      <Message state={state} />
    </form>
  );
}
