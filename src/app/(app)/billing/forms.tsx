"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { FileUpload } from "@/components/file-upload";
import { ClientPicker } from "@/components/client-picker";
import { calcEstimate, calcEstimateLine, calcSettlement, DOC_TYPE_LABEL, markupText, previousMonthRange, won, type DocType, type MarkupType, type VatMode } from "@/lib/billing-calc";
import { formatBizNo } from "@/lib/bizno";
import { pickContract } from "@/lib/contract-pick";
import type { FormState } from "./actions";

type Action = (prev: FormState, f: FormData) => Promise<FormState>;

export type FormClient = {
  id: string;
  company_name: string;
  business_number: string | null;
  representative_name: string | null;
  address: string | null;
  billing_emails: string[];
  has_registration: boolean;
  fee?: { markup_type: MarkupType; markup_rate: number; markup_fixed: number; min_fee: number; vat_mode: VatMode; note: string | null };
};
export type FormContract = {
  id: string;
  client_id: string;
  start_date: string | null;
  end_date: string | null;
  contract_date: string;
  markup_type: MarkupType;
  markup_rate: number;
  markup_fixed: number;
  min_fee: number;
  vat_mode: VatMode;
};

export type BillingValues = {
  doc_type: DocType;
  supplier_code?: string;
  client_id?: string;
  contract_id?: string | null;
  document_date: string;
  period_start?: string | null;
  period_end?: string | null;
  spend_amount?: number;
  markup_type?: MarkupType;
  markup_rate?: number;
  markup_fixed?: number;
  min_fee?: number;
  vat_mode?: VatMode;
  adjustment_amount?: number;
  adjustment_reason?: string | null;
  note?: string | null;
  item_description?: string | null;
  items?: { item_name: string; description: string | null; unit_price: number; quantity: number }[];
};

let keySeq = 0;
const newKey = () => `l-${++keySeq}`;
const toNum = (v: string) => Number(v.replace(/[^\d.-]/g, "")) || 0;
const fmt = (n: number) => (n ? n.toLocaleString("ko-KR") : "");

export function Message({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

function MoneyInput({ name, value, onChange, placeholder, allowMinus = false }: { name: string; value: string; onChange: (v: string) => void; placeholder?: string; allowMinus?: boolean }) {
  return (
    <input
      id={name}
      name={name}
      inputMode="numeric"
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        const minus = allowMinus && raw.trim().startsWith("-");
        const d = raw.replace(/[^\d]/g, "");
        onChange(d ? (minus ? "-" : "") + Number(d).toLocaleString("ko-KR") : minus ? "-" : "");
      }}
      className="field text-right tabular-nums"
    />
  );
}

export function BillingForm({
  action,
  clients,
  contracts,
  suppliers,
  initial,
  existingFiles = 0,
  readOnly = false,
  isNew,
}: {
  action: Action;
  clients: FormClient[];
  contracts: FormContract[];
  suppliers: { code: string; name: string }[];
  initial: BillingValues;
  existingFiles?: number;
  readOnly?: boolean;
  isNew: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [docType, setDocType] = useState<DocType>(initial.doc_type);
  const [clientId, setClientId] = useState(initial.client_id ?? "");
  const [docDate, setDocDate] = useState(initial.document_date);
  const prev = previousMonthRange(initial.document_date);
  const [periodStart, setPeriodStart] = useState(initial.period_start ?? prev.start);
  const [periodEnd, setPeriodEnd] = useState(initial.period_end ?? prev.end);
  const [spend, setSpend] = useState(fmt(initial.spend_amount ?? 0));
  const [markupType, setMarkupType] = useState<MarkupType>(initial.markup_type ?? "rate");
  const [rate, setRate] = useState(initial.markup_rate ? String(initial.markup_rate) : "");
  const [fixed, setFixed] = useState(fmt(initial.markup_fixed ?? 0));
  const [minFee, setMinFee] = useState(fmt(initial.min_fee ?? 0));
  const [vatMode, setVatMode] = useState<VatMode>(initial.vat_mode ?? "included");
  const [contractId, setContractId] = useState(initial.contract_id ?? "");
  const [adjust, setAdjust] = useState(fmt(initial.adjustment_amount ?? 0));
  const [itemDesc, setItemDesc] = useState(initial.item_description ?? `${Number(prev.start.slice(5, 7))}월 광고비`);
  const [lines, setLines] = useState(
    (initial.items?.length ? initial.items : [{ item_name: "", description: null, unit_price: 0, quantity: 1 }]).map((l) => ({
      key: newKey(),
      item_name: l.item_name,
      description: l.description ?? "",
      unit: fmt(l.unit_price),
      qty: String(l.quantity),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [newFiles, setNewFiles] = useState(0);
  const [applied, setApplied] = useState<string>("");

  const client = clients.find((c) => c.id === clientId);
  const isSettlement = docType === "settlement";

  // 거래처·작성일이 바뀌면 유효한 계약 조건을 자동으로 넣음
  function applyContract(cid: string, date: string) {
    const k = pickContract(contracts, cid, date);
    if (!k) {
      setContractId("");
      // 계약이 없으면 거래처에 정해 둔 기본 수수료 조건
      const fee = clients.find((c) => c.id === cid)?.fee;
      if (fee && fee.markup_type !== "none") {
        setMarkupType(fee.markup_type);
        setRate(fee.markup_rate ? String(fee.markup_rate) : "");
        setFixed(fmt(fee.markup_fixed));
        setMinFee(fmt(fee.min_fee));
        setVatMode(fee.vat_mode);
        setApplied("client");
        return;
      }
      setApplied(cid ? "none" : "");
      return;
    }
    setContractId(k.id);
    setMarkupType(k.markup_type);
    setRate(k.markup_rate ? String(k.markup_rate) : "");
    setFixed(fmt(k.markup_fixed));
    setMinFee(fmt(k.min_fee));
    setVatMode(k.vat_mode);
    setApplied(k.id);
  }

  const calc = useMemo(() => {
    if (isSettlement)
      return calcSettlement({ spend: toNum(spend), markupType, markupRate: Number(rate) || 0, markupFixed: toNum(fixed), minFee: toNum(minFee), vatMode, adjustment: toNum(adjust) });
    const e = calcEstimate(lines.map((l) => ({ unitPrice: toNum(l.unit), quantity: Number(l.qty) || 0 })), toNum(adjust));
    return { rawMarkup: 0, markup: 0, minApplied: false, ...e };
  }, [isSettlement, spend, markupType, rate, fixed, minFee, vatMode, adjust, lines]);

  const appliedContract = contracts.find((k) => k.id === contractId);
  const itemsJson = JSON.stringify(lines.map((l) => ({ item_name: l.item_name, description: l.description, unit_price: toNum(l.unit), quantity: Number(l.qty) || 0 })));
  const evidenceCount = existingFiles + newFiles;

  return (
    <form action={formAction} className="grid gap-5 lg:grid-cols-[3fr_2fr]">
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="doc_type">문서 종류</label>
            <select id="doc_type" name="doc_type" value={docType} onChange={(e) => { const t = e.target.value as DocType; setDocType(t); if (t === "settlement" && clientId) applyContract(clientId, docDate); }} disabled={!isNew} className="field">
              {(Object.keys(DOC_TYPE_LABEL) as DocType[]).map((t) => <option key={t} value={t}>{t === "settlement" ? "광고비 정산 (세금계산서 발행요청)" : DOC_TYPE_LABEL[t]}</option>)}
            </select>
            {!isNew && <input type="hidden" name="doc_type" value={docType} />}
          </div>
          <div>
            <label className="label" htmlFor="supplier_code">발행 사업장</label>
            <select id="supplier_code" name="supplier_code" defaultValue={initial.supplier_code ?? "ga"} className="field">
              {suppliers.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="client_id">거래처 *</label>
            <ClientPicker
              id="client_id"
              name="client_id"
              required
              disabled={readOnly}
              value={clientId}
              onChange={(id) => {
                setClientId(id);
                if (isSettlement) applyContract(id, docDate);
              }}
              clients={clients.map((c) => ({ id: c.id, company_name: c.company_name, business_number: c.business_number, note: c.business_number ? undefined : "(사업자번호 없음)" }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="document_date">작성일</label>
            <input id="document_date" name="document_date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="field" />
          </div>
        </div>

        {client && (
          <div className="rounded-xl border border-[var(--glass-border)] bg-white/70 p-4 text-sm">
            <p className="mb-2 text-xs font-semibold text-ink-soft">받는 곳 (거래처 정보에서 자동)</p>
            <dl className="grid grid-cols-[88px_1fr] gap-y-1">
              <dt className="text-ink-soft">대표자</dt><dd>{client.representative_name ?? "-"}</dd>
              <dt className="text-ink-soft">사업자번호</dt><dd className="tabular-nums">{formatBizNo(client.business_number) || <span className="text-danger">없음</span>}</dd>
              <dt className="text-ink-soft">주소</dt><dd>{client.address ?? "-"}</dd>
              <dt className="text-ink-soft">계산서 메일</dt><dd>{client.billing_emails.join(", ") || <span className="text-danger">없음</span>}</dd>
              <dt className="text-ink-soft">사업자등록증</dt><dd>{client.has_registration ? "있음" : <span className="text-[var(--warn-ink)]">없음 · 거래처 화면에서 올려 주세요</span>}</dd>
            </dl>
            <Link href={`/clients/${client.id}`} className="mt-2 inline-block text-xs text-brand underline">거래처 정보 고치기</Link>
          </div>
        )}

        {isSettlement ? (
          <div className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="contract_id" value={contractId} />
            <div className="md:col-span-2">
              {applied && applied !== "none" && applied !== "client" && appliedContract && (
                <p className="chip chip-ok">계약 조건 자동 적용: {markupText(appliedContract.markup_type, appliedContract.markup_rate, appliedContract.markup_fixed)} · VAT {appliedContract.vat_mode === "included" ? "포함" : "별도"}{appliedContract.min_fee ? ` · 최소 ${won(appliedContract.min_fee)}` : ""}</p>
              )}
              {applied === "client" && client?.fee && (
                <p className="chip chip-ok">거래처 기본 수수료 적용: {markupText(client.fee.markup_type, client.fee.markup_rate, client.fee.markup_fixed)} · VAT {client.fee.vat_mode === "included" ? "포함" : "별도"}{client.fee.min_fee ? ` · 최소 ${won(client.fee.min_fee)}` : ""}{client.fee.note ? ` · ${client.fee.note}` : ""}</p>
              )}
              {applied === "none" && <p className="chip chip-warn">완료된 계약도, 거래처 기본 수수료도 없습니다. 조건을 직접 입력해 주세요.</p>}
              {!applied && contractId && appliedContract && <p className="chip chip-info">연결된 계약: {markupText(appliedContract.markup_type, appliedContract.markup_rate, appliedContract.markup_fixed)}</p>}
            </div>
            <div>
              <label className="label" htmlFor="period_start">정산 시작일</label>
              <input id="period_start" name="period_start" type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); if (e.target.value) setItemDesc(`${Number(e.target.value.slice(5, 7))}월 광고비`); }} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="period_end">정산 종료일</label>
              <input id="period_end" name="period_end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="spend_amount">광고비 소진액 (원)</label>
              <MoneyInput name="spend_amount" value={spend} onChange={setSpend} placeholder="0" />
              <p className="mt-1 text-xs text-ink-soft">계산 기준일 뿐 청구 금액에 들어가지 않습니다.</p>
            </div>
            <div>
              <label className="label" htmlFor="item_description">내용</label>
              <input id="item_description" name="item_description" value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="markup_type">마크업 방식</label>
              <select id="markup_type" name="markup_type" value={markupType} onChange={(e) => setMarkupType(e.target.value as MarkupType)} className="field">
                <option value="rate">요율 (%)</option>
                <option value="fixed">고정비</option>
                <option value="none">없음</option>
              </select>
            </div>
            <div>
              {markupType === "rate" && (<><label className="label" htmlFor="markup_rate">요율 (%)</label><input id="markup_rate" name="markup_rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} className="field" /></>)}
              {markupType === "fixed" && (<><label className="label" htmlFor="markup_fixed">고정비 (원)</label><MoneyInput name="markup_fixed" value={fixed} onChange={setFixed} /></>)}
            </div>
            <div>
              <label className="label" htmlFor="min_fee">최소 대행비 (VAT 포함)</label>
              <MoneyInput name="min_fee" value={minFee} onChange={setMinFee} placeholder="0" />
            </div>
            <div>
              <label className="label" htmlFor="vat_mode">VAT 처리</label>
              <select id="vat_mode" name="vat_mode" value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)} className="field">
                <option value="included">마크업 금액에 VAT 포함</option>
                <option value="excluded">마크업 금액에 VAT 10% 별도</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input type="hidden" name="items" value={itemsJson} />
            <div className="flex items-center justify-between">
              <span className="label mb-0">견적 품목 (단가는 VAT 포함)</span>
              <button type="button" className="text-sm text-brand underline" onClick={() => setLines([...lines, { key: newKey(), item_name: "", description: "", unit: "", qty: "1" }])}>+ 품목 추가</button>
            </div>
            {lines.map((l, i) => {
              const r = calcEstimateLine(toNum(l.unit), Number(l.qty) || 0);
              const set = (patch: Partial<typeof l>) => setLines(lines.map((x) => (x.key === l.key ? { ...x, ...patch } : x)));
              return (
                <div key={l.key} className="grid gap-2 rounded-xl border border-[var(--glass-border)] bg-white/60 p-3 md:grid-cols-[2fr_2fr_1.2fr_0.6fr_auto]">
                  <input aria-label={`${i + 1}번 품명`} placeholder="품명" value={l.item_name} onChange={(e) => set({ item_name: e.target.value })} className="field" />
                  <input aria-label={`${i + 1}번 내용`} placeholder="내용 (선택)" value={l.description} onChange={(e) => set({ description: e.target.value })} className="field" />
                  <input aria-label={`${i + 1}번 단가`} placeholder="단가" inputMode="numeric" value={l.unit} onChange={(e) => { const d = e.target.value.replace(/[^\d]/g, ""); set({ unit: d ? Number(d).toLocaleString("ko-KR") : "" }); }} className="field text-right tabular-nums" />
                  <input aria-label={`${i + 1}번 수량`} placeholder="수량" inputMode="decimal" value={l.qty} onChange={(e) => set({ qty: e.target.value.replace(/[^\d.]/g, "") })} className="field text-right" />
                  <button type="button" className="text-xs text-danger underline" onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : lines)}>삭제</button>
                  <p className="text-xs text-ink-soft md:col-span-5">공급가 {won(r.supply)} · 세액 {won(r.vat)} · 합계 {won(r.total)}</p>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="adjustment">추가(+) / 차감(-) 금액</label>
            <MoneyInput name="adjustment" value={adjust} onChange={setAdjust} placeholder="0" allowMinus />
          </div>
          <div>
            <label className="label" htmlFor="adjustment_reason">추가/차감 사유</label>
            <input id="adjustment_reason" name="adjustment_reason" defaultValue={initial.adjustment_reason ?? ""} className="field" />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="note">비고 (문서에 표시)</label>
            <textarea id="note" name="note" rows={2} defaultValue={initial.note ?? ""} className="field" />
          </div>
        </div>

        {isSettlement && (
          <div>
            <span className="label">광고비 소진 증빙 (네이버·메타 등 사용 화면 캡처/PDF){existingFiles > 0 && ` · 이미 ${existingFiles}개 있음`}</span>
            <FileUpload name="evidence" folder="billing/evidence" onBusyChange={setBusy} onChange={(f) => setNewFiles(f.length)} />
          </div>
        )}
      </fieldset>

      <aside className="h-fit space-y-3 rounded-xl border border-[var(--glass-border)] bg-white/70 p-4 lg:sticky lg:top-20">
        <p className="font-bold">자동 계산</p>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm tabular-nums">
          {isSettlement && (
            <>
              <dt className="text-ink-soft">광고비 소진액 (기준)</dt><dd>{won(toNum(spend))}</dd>
              <dt className="text-ink-soft">마크업 비용</dt>
              <dd>{won(calc.markup)}{calc.minApplied && <span className="chip chip-warn ml-1">최소 대행비</span>}</dd>
            </>
          )}
          <dt className="text-ink-soft">공급가액</dt><dd>{won(calc.supply)}</dd>
          <dt className="text-ink-soft">세액</dt><dd>{won(calc.vat)}</dd>
          {calc.adjustment !== 0 && (<><dt className="text-ink-soft">추가/차감</dt><dd>{won(calc.adjustment)}</dd></>)}
          <dt className="border-t border-[var(--glass-border)] pt-2 font-bold">{isSettlement ? "세금계산서 발행 요청금액" : "견적 합계 (VAT 포함)"}</dt>
          <dd className="border-t border-[var(--glass-border)] pt-2 text-lg font-bold">{won(calc.total)}</dd>
        </dl>
        {isSettlement && (
          <p className={`text-xs ${evidenceCount ? "text-ink-soft" : "text-[var(--warn-ink)]"}`}>증빙 {evidenceCount}개{evidenceCount ? "" : " · 승인 요청 전에 꼭 올려 주세요"}</p>
        )}
        <Message state={state} />
        {!readOnly && (
          <div className="flex flex-col gap-2">
            <button name="intent" value="requested" className="btn" disabled={pending || busy}>{pending ? "저장 중…" : "저장하고 승인 요청"}</button>
            <button name="intent" value="draft" className="btn btn-ghost" disabled={pending || busy}>임시 저장</button>
          </div>
        )}
      </aside>
    </form>
  );
}
