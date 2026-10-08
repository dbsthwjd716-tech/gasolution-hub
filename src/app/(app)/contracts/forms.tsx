"use client";

import { useActionState, useState } from "react";
import { FileUpload } from "@/components/file-upload";
import { ClientPicker } from "@/components/client-picker";
import type { FormState } from "./actions";

type Action = (prev: FormState, f: FormData) => Promise<FormState>;

export type ContractClient = { id: string; company_name: string; business_number: string | null; brands: { id: string; name: string }[] };

export type ContractValues = {
  client_id?: string;
  brand_id?: string | null;
  staff_id?: string | null;
  contract_date?: string;
  start_date?: string | null;
  end_date?: string | null;
  media?: string[];
  markup_type?: "rate" | "fixed" | "none";
  markup_rate?: number;
  markup_fixed?: number;
  min_fee?: number;
  vat_mode?: "included" | "excluded";
  auto_renew?: boolean;
  document_required?: boolean;
  special_terms?: string | null;
};

const MEDIA = [
  ["naver", "네이버"],
  ["gfa", "GFA"],
  ["meta", "메타"],
  ["google", "구글"],
  ["kakao", "카카오"],
  ["coupang", "쿠팡"],
  ["other", "기타"],
] as const;

export function Message({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

export function ContractForm({
  action,
  clients,
  staff,
  initial = {},
  canPickStaff,
  submitLabel,
  readOnly = false,
}: {
  action: Action;
  clients: ContractClient[];
  staff: { id: string; name: string }[];
  initial?: ContractValues;
  canPickStaff: boolean;
  submitLabel: string;
  readOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [clientId, setClientId] = useState(initial.client_id ?? "");
  const [markupType, setMarkupType] = useState(initial.markup_type ?? "rate");
  const [minFee, setMinFee] = useState(String(initial.min_fee ?? 0));
  const client = clients.find((c) => c.id === clientId);
  const media = initial.media ?? [];

  return (
    <form action={formAction} className="space-y-5">
      <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="client_id">거래처 *</label>
          <ClientPicker
            id="client_id"
            name="client_id"
            required
            disabled={readOnly}
            value={clientId}
            onChange={setClientId}
            clients={clients.map((c) => ({ id: c.id, company_name: c.company_name, business_number: c.business_number, note: c.business_number ? undefined : "(사업자번호 없음)" }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="brand_id">브랜드 (선택)</label>
          <select id="brand_id" name="brand_id" defaultValue={initial.brand_id ?? ""} key={clientId} className="field">
            <option value="">전체 / 지정 안 함</option>
            {(client?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="contract_date">계약일 *</label>
          <input id="contract_date" name="contract_date" type="date" required defaultValue={initial.contract_date} className="field" />
        </div>
        {canPickStaff ? (
          <div>
            <label className="label" htmlFor="staff_id">담당</label>
            <select id="staff_id" name="staff_id" defaultValue={initial.staff_id ?? ""} className="field">
              <option value="">등록한 사람</option>
              {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
        ) : <div />}
        <div>
          <label className="label" htmlFor="start_date">계약 시작일</label>
          <input id="start_date" name="start_date" type="date" defaultValue={initial.start_date ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="end_date">계약 종료일 (비우면 기한 없음)</label>
          <input id="end_date" name="end_date" type="date" defaultValue={initial.end_date ?? ""} className="field" />
        </div>
        <div className="md:col-span-2">
          <span className="label">광고 매체</span>
          <div className="flex flex-wrap gap-4 pt-1 text-sm">
            {MEDIA.map(([v, l]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="checkbox" name="media" value={v} defaultChecked={media.includes(v)} /> {l}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="markup_type">마크업(대행 수수료) 방식</label>
          <select id="markup_type" name="markup_type" value={markupType} onChange={(e) => setMarkupType(e.target.value as typeof markupType)} className="field">
            <option value="rate">요율 (광고비의 %)</option>
            <option value="fixed">월 고정비</option>
            <option value="none">없음</option>
          </select>
        </div>
        <div>
          {markupType === "rate" && (
            <>
              <label className="label" htmlFor="markup_rate">요율 (%)</label>
              <input id="markup_rate" name="markup_rate" inputMode="decimal" defaultValue={initial.markup_rate ?? ""} placeholder="예: 14.3" className="field" />
            </>
          )}
          {markupType === "fixed" && (
            <>
              <label className="label" htmlFor="markup_fixed">월 고정비 (원)</label>
              <input id="markup_fixed" name="markup_fixed" inputMode="numeric" defaultValue={initial.markup_fixed ?? ""} className="field" />
            </>
          )}
        </div>
        <div>
          <label className="label" htmlFor="min_fee">최소 대행비 (VAT 포함, 원)</label>
          <div className="flex gap-2">
            <input id="min_fee" name="min_fee" inputMode="numeric" value={minFee} onChange={(e) => setMinFee(e.target.value)} className="field" />
            <button type="button" className="btn btn-ghost px-3 text-xs" onClick={() => setMinFee("330000")}>33만원</button>
          </div>
          <p className="mt-1 text-xs text-ink-soft">마크업이 이 금액보다 적으면 이 금액으로 청구합니다. 없으면 0.</p>
        </div>
        <div>
          <label className="label" htmlFor="vat_mode">VAT 처리</label>
          <select id="vat_mode" name="vat_mode" defaultValue={initial.vat_mode ?? "included"} className="field">
            <option value="included">마크업 금액에 VAT 포함</option>
            <option value="excluded">마크업 금액에 VAT 10% 별도</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-5 text-sm md:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="auto_renew" defaultChecked={initial.auto_renew ?? true} /> 자동 연장 (1개월씩)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="document_required" defaultChecked={initial.document_required ?? true} /> 계약서 작성
          </label>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="special_terms">특약 · 기타 조건</label>
          <textarea id="special_terms" name="special_terms" rows={3} defaultValue={initial.special_terms ?? ""} className="field" />
        </div>
      </fieldset>
      <Message state={state} />
      {!readOnly && <button className="btn" disabled={pending}>{pending ? "저장 중…" : submitLabel}</button>}
    </form>
  );
}

// 진행 단계 버튼 하나 (반려는 사유 입력, 서명 완료는 파일 업로드)
export function StepButton({ action, step, label, ghost = false, confirmText }: { action: Action; step: string; label: string; ghost?: boolean; confirmText?: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className="space-y-1"
    >
      <input type="hidden" name="step" value={step} />
      <button className={`btn w-full ${ghost ? "btn-ghost" : ""}`} disabled={pending}>{pending ? "…" : label}</button>
      <Message state={state} />
    </form>
  );
}

export function RejectForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="step" value="rejected" />
      <input name="reason" placeholder="반려 사유" className="field" />
      <button className="btn btn-ghost w-full text-danger" disabled={pending}>반려</button>
      <Message state={state} />
    </form>
  );
}

export function SignedUploadForm({ action, step, label }: { action: Action; step: "upload_signed" | "complete_signed"; label: string }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [busy, setBusy] = useState(false);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="step" value={step} />
      <FileUpload name="signed_file" folder="contracts/signed" accept="application/pdf" multiple={false} onBusyChange={setBusy} />
      <button className="btn w-full" disabled={pending || busy}>{pending ? "…" : label}</button>
      <Message state={state} />
    </form>
  );
}
