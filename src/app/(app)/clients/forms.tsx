"use client";

import { useActionState, useState } from "react";
import { FileUpload } from "@/components/file-upload";
import { checkBizNo, formatBizNo } from "@/lib/bizno";
import type { FormState } from "./actions";

type Action = (prev: FormState, f: FormData) => Promise<FormState>;

export type ClientValues = {
  company_name?: string;
  business_number?: string | null;
  representative_name?: string | null;
  address?: string | null;
  business_type?: string | null;
  business_item?: string | null;
  billing_emails?: string[];
  status?: string;
  kinds?: string[];
  memo?: string | null;
  fee_markup_type?: "rate" | "fixed" | "none";
  fee_markup_rate?: number;
  fee_markup_fixed?: number;
  fee_min_fee?: number;
  fee_vat_mode?: "included" | "excluded";
  fee_note?: string | null;
  owner_staff_id?: string | null;
};

const comma = (v: string) => {
  const d = v.replace(/[^\d]/g, "");
  return d ? Number(d).toLocaleString("ko-KR") : "";
};

// 기본 수수료 조건: 정산서를 쓸 때 계약이 없으면 이 값으로 자동 계산
function FeeFields({ initial }: { initial: ClientValues }) {
  const [type, setType] = useState(initial.fee_markup_type ?? "none");
  const [fixed, setFixed] = useState(initial.fee_markup_fixed ? comma(String(initial.fee_markup_fixed)) : "");
  const [minFee, setMinFee] = useState(initial.fee_min_fee ? comma(String(initial.fee_min_fee)) : "");
  return (
    <div className="space-y-3 rounded-xl border border-[var(--glass-border)] bg-white/60 p-4 md:col-span-2">
      <div>
        <p className="text-sm font-bold">계약 수수료 (기본 조건)</p>
        <p className="text-xs text-ink-soft">정산서를 쓸 때 그 날짜에 맞는 계약이 없으면 이 조건으로 자동 계산합니다. 계약이 있으면 계약 조건이 먼저입니다.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-ink-soft">방식
          <select name="fee_markup_type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className="field mt-1">
            <option value="rate">광고비의 % (마크업)</option>
            <option value="fixed">고정 금액 (광고비와 관계없이)</option>
            <option value="none">없음 · 정하지 않음</option>
          </select>
        </label>
        {type === "rate" && (
          <label className="text-xs text-ink-soft">수수료율 (%)
            <input name="fee_markup_rate" inputMode="decimal" defaultValue={initial.fee_markup_rate ? String(initial.fee_markup_rate) : ""} placeholder="예: 14.3" className="field mt-1 text-right" />
          </label>
        )}
        {type === "fixed" && (
          <label className="text-xs text-ink-soft">고정 금액 (원)
            <input name="fee_markup_fixed" inputMode="numeric" value={fixed} onChange={(e) => setFixed(comma(e.target.value))} placeholder="예: 220,000" className="field mt-1 text-right tabular-nums" />
          </label>
        )}
        {type === "rate" && (
          <label className="text-xs text-ink-soft">최소 수수료 (원, 선택)
            <input name="fee_min_fee" inputMode="numeric" value={minFee} onChange={(e) => setMinFee(comma(e.target.value))} placeholder="없으면 비워 두기" className="field mt-1 text-right tabular-nums" />
          </label>
        )}
        {type !== "none" && (
          <label className="text-xs text-ink-soft">광고비 VAT
            <select name="fee_vat_mode" defaultValue={initial.fee_vat_mode ?? "included"} className="field mt-1">
              <option value="included">광고비 VAT 포함 금액 기준</option>
              <option value="excluded">광고비 VAT 별도 금액 기준</option>
            </select>
          </label>
        )}
      </div>
      <input name="fee_note" defaultValue={initial.fee_note ?? ""} placeholder="조건 설명 (선택) · 예: 쿠팡 광고비와 관계없이 월 22만원" className="field" aria-label="수수료 조건 설명" />
    </div>
  );
}

function Message({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

// 거래처 등록·수정 양식
export function ClientForm({
  action,
  initial = {},
  submitLabel,
  showBrand = false,
  readOnly = false,
  staff = [],
}: {
  action: Action;
  initial?: ClientValues;
  submitLabel: string;
  showBrand?: boolean;
  readOnly?: boolean;
  staff?: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [bn, setBn] = useState(formatBizNo(initial.business_number ?? null) || "");
  const bnCheck = checkBizNo(bn);
  const kinds = initial.kinds ?? ["ad"];

  return (
    <form action={formAction} className="space-y-5">
      <fieldset disabled={readOnly} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="label" htmlFor="company_name">상호 (사업자등록증 기준) *</label>
          <input id="company_name" name="company_name" required defaultValue={initial.company_name} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="business_number">사업자번호</label>
          <input
            id="business_number"
            name="business_number"
            inputMode="numeric"
            placeholder="000-00-00000"
            value={bn}
            onChange={(e) => setBn(e.target.value)}
            className="field"
          />
          <p className={`mt-1 text-xs ${bnCheck.ok ? "text-ink-soft" : "text-danger"}`}>
            {!bnCheck.ok
              ? bnCheck.message
              : bnCheck.value
                ? "확인됨"
                : "비워 두면 임시 거래처로 등록됩니다. 나중에 채우면 됩니다."}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="representative_name">대표자</label>
          <input id="representative_name" name="representative_name" defaultValue={initial.representative_name ?? ""} className="field" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="address">사업장 주소</label>
          <input id="address" name="address" defaultValue={initial.address ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="business_type">업태</label>
          <input id="business_type" name="business_type" defaultValue={initial.business_type ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="business_item">종목</label>
          <input id="business_item" name="business_item" defaultValue={initial.business_item ?? ""} className="field" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="billing_emails">세금계산서 받는 메일 (여러 개는 쉼표로)</label>
          <input id="billing_emails" name="billing_emails" defaultValue={(initial.billing_emails ?? []).join(", ")} className="field" />
        </div>
        <div>
          <span className="label">거래 구분</span>
          <div className="flex gap-4 pt-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="kinds" value="ad" defaultChecked={kinds.includes("ad")} /> 광고 대행
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="kinds" value="viral" defaultChecked={kinds.includes("viral")} /> 바이럴
            </label>
          </div>
        </div>
        {staff.length > 0 && (
          <div>
            <label className="label" htmlFor="owner_staff_id">우리 담당 직원</label>
            <select id="owner_staff_id" name="owner_staff_id" defaultValue={initial.owner_staff_id ?? ""} className="field">
              <option value="">담당 없음</option>
              {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-ink-soft">이 거래처를 맡은 직원 (처음 등록한 사람이 자동으로 들어갑니다)</p>
          </div>
        )}
        <div>
          <label className="label" htmlFor="status">상태</label>
          <select id="status" name="status" defaultValue={initial.status ?? "active"} className="field">
            <option value="lead">문의·계약 전</option>
            <option value="active">운영 중</option>
            <option value="ended">종료</option>
          </select>
        </div>
        {showBrand && (
          <div className="md:col-span-2">
            <label className="label" htmlFor="brand_name">첫 브랜드(광고주) 이름</label>
            <input id="brand_name" name="brand_name" placeholder="예: 티키타카. 상호와 같으면 그대로 적어 주세요" className="field" />
          </div>
        )}
        <FeeFields initial={initial} />
        <div className="md:col-span-2">
          <label className="label" htmlFor="memo">메모</label>
          <textarea id="memo" name="memo" rows={3} defaultValue={initial.memo ?? ""} className="field" />
        </div>
      </fieldset>
      <Message state={state} />
      {!readOnly && (
        <button className="btn" disabled={pending || !bnCheck.ok}>
          {pending ? "저장 중…" : submitLabel}
        </button>
      )}
    </form>
  );
}

// 브랜드·계정·연락처·다른 이름처럼 한 줄로 추가하는 작은 양식
export function InlineForm({
  action,
  children,
  submitLabel = "추가",
}: {
  action: Action;
  children: React.ReactNode;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {children}
        <button className="btn btn-ghost" disabled={pending}>
          {pending ? "…" : submitLabel}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

// 사업자등록증·통장사본 올리기
export function DocumentUploadForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [busy, setBusy] = useState(false);
  return (
    <form action={formAction} className="space-y-2">
      <select name="document_type" className="field" aria-label="서류 종류" defaultValue="business_registration">
        <option value="business_registration">사업자등록증</option>
        <option value="bank_account">통장 사본</option>
        <option value="other">기타</option>
      </select>
      <FileUpload name="files" folder="clients/documents" onBusyChange={setBusy} />
      <button className="btn btn-ghost" disabled={pending || busy}>{pending ? "…" : "등록"}</button>
      <Message state={state} />
    </form>
  );
}
