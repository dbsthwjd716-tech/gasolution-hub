"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { formatBizNo } from "@/lib/bizno";
import type { FormState } from "./actions";

type Action = (prev: FormState, f: FormData) => Promise<FormState>;

export type ClientOption = {
  id: string;
  company_name: string;
  business_number: string | null;
  representative_name: string | null;
  address: string | null;
  billing_emails: string[];
  has_registration: boolean;
  aliases: string[];
  brands: { id: string; name: string }[];
};

export type OrderValues = {
  client_id?: string;
  brand_id?: string | null;
  partner_id?: string;
  paid_date?: string;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  cost_amount?: number;
  sale_amount?: number;
  memo?: string | null;
};

const won = (n: number) => n.toLocaleString("ko-KR");
// 한국 시간 기준 오늘 (YYYY-MM-DD)
const todayKST = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const digits = (v: string) => Number(v.replace(/[^\d]/g, "") || 0);
const norm = (v: string) => v.replace(/(주식회사|\(주\)|㈜)/g, "").replace(/[\s\-_.()[\]/·,]/g, "").toLowerCase();

function Message({ state }: { state: FormState }) {
  if (state.error) return <p className="text-sm text-danger" role="alert">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-[var(--ok-ink)]">{state.ok}</p>;
  return null;
}

// 거래처를 고르면 세금계산서에 들어갈 업체 정보가 자동으로 보이는 카드
function ClientInfo({ c }: { c: ClientOption }) {
  const missing = [
    !c.business_number && "사업자번호",
    !c.representative_name && "대표자",
    !c.address && "주소",
    !c.billing_emails.length && "세금계산서 메일",
    !c.has_registration && "사업자등록증",
  ].filter(Boolean) as string[];
  return (
    <div className="rounded-xl border border-[var(--glass-border)] bg-white/70 p-4 text-sm">
      <p className="mb-2 text-xs font-semibold text-ink-soft">거래처에서 자동으로 가져온 정보</p>
      <dl className="grid grid-cols-[88px_1fr] gap-y-1">
        <dt className="text-ink-soft">상호</dt><dd className="font-semibold">{c.company_name}</dd>
        <dt className="text-ink-soft">대표자</dt><dd>{c.representative_name ?? "-"}</dd>
        <dt className="text-ink-soft">사업자번호</dt><dd className="tabular-nums">{formatBizNo(c.business_number) || "-"}</dd>
        <dt className="text-ink-soft">주소</dt><dd>{c.address ?? "-"}</dd>
        <dt className="text-ink-soft">계산서 메일</dt><dd>{c.billing_emails.join(", ") || "-"}</dd>
        <dt className="text-ink-soft">사업자등록증</dt><dd>{c.has_registration ? "있음" : "없음"}</dd>
      </dl>
      {missing.length > 0 && (
        <p className="mt-3 rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-xs text-[var(--warn-ink)]">
          비어 있는 정보: {missing.join(", ")}.{" "}
          <Link href={`/clients/${c.id}`} target="_blank" className="font-semibold underline">거래처에서 채우기</Link>
          {" "}— 한 번 채우면 다음 건부터 자동으로 들어갑니다.
        </p>
      )}
    </div>
  );
}

export function ViralOrderForm({
  action,
  clients,
  partners,
  initial = {},
  submitLabel,
  readOnly = false,
}: {
  action: Action;
  clients: ClientOption[];
  partners: { id: string; name: string }[];
  initial?: OrderValues;
  submitLabel: string;
  readOnly?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [clientId, setClientId] = useState(initial.client_id ?? "");
  const [q, setQ] = useState("");
  const [cost, setCost] = useState(initial.cost_amount != null ? won(initial.cost_amount) : "");
  const [sale, setSale] = useState(initial.sale_amount != null ? won(initial.sale_amount) : "");
  const client = clients.find((c) => c.id === clientId);
  const margin = digits(sale) - digits(cost);

  const matches = useMemo(() => {
    const n = norm(q);
    if (!n) return [];
    return clients
      .filter((c) => [c.company_name, ...c.aliases, ...c.brands.map((b) => b.name), c.business_number ?? ""].some((x) => norm(x).includes(n)))
      .slice(0, 8);
  }, [q, clients]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="client_id" value={clientId} />
      <fieldset disabled={readOnly} className="space-y-5">
        <div>
          <span className="label">거래처 *</span>
          {client ? (
            <div className="space-y-2">
              <ClientInfo c={client} />
              {!readOnly && (
                <button type="button" className="text-xs text-brand underline" onClick={() => setClientId("")}>
                  다른 거래처 고르기
                </button>
              )}
            </div>
          ) : (
            <div className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="상호·브랜드·사업자번호로 검색"
                className="field"
                aria-label="거래처 검색"
                autoComplete="off"
              />
              {q && (
                <ul className="glass absolute z-10 mt-1 w-full overflow-hidden">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => { setClientId(c.id); setQ(""); }}
                        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-brand-soft"
                      >
                        <span className="font-semibold">{c.company_name}</span>
                        <span className="text-xs text-ink-soft tabular-nums">{formatBizNo(c.business_number) || "사업자번호 없음"}</span>
                      </button>
                    </li>
                  ))}
                  {!matches.length && (
                    <li className="px-4 py-3 text-sm text-ink-soft">
                      맞는 거래처가 없습니다.{" "}
                      <Link href="/clients/new" target="_blank" className="font-semibold text-brand underline">새 거래처 등록</Link>
                      {" "}후 다시 검색해 주세요.
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {client && client.brands.length > 0 && (
            <div>
              <label className="label" htmlFor="brand_id">브랜드</label>
              <select id="brand_id" name="brand_id" defaultValue={initial.brand_id ?? ""} className="field">
                <option value="">(선택 안 함)</option>
                {client.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="partner_id">협력사 *</label>
            <select id="partner_id" name="partner_id" required defaultValue={initial.partner_id ?? ""} className="field">
              <option value="" disabled>골라 주세요</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="paid_date">입금일(시작일) *</label>
            <input id="paid_date" name="paid_date" type="date" required defaultValue={initial.paid_date ?? todayKST()} className="field" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="start_date">진행 시작</label>
              <input id="start_date" name="start_date" type="date" defaultValue={initial.start_date ?? ""} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="end_date">진행 끝</label>
              <input id="end_date" name="end_date" type="date" defaultValue={initial.end_date ?? ""} className="field" />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="description">상품 내용</label>
            <input id="description" name="description" placeholder="예: 블로그리뷰 50건, 플레이스 최적화 30일" defaultValue={initial.description ?? ""} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="cost_amount">공급가 (협력사 견적, VAT 포함)</label>
            <input id="cost_amount" name="cost_amount" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value ? won(digits(e.target.value)) : "")} className="field text-right tabular-nums" />
          </div>
          <div>
            <label className="label" htmlFor="sale_amount">판매가 (고객 안내 금액) *</label>
            <input id="sale_amount" name="sale_amount" inputMode="numeric" required value={sale} onChange={(e) => setSale(e.target.value ? won(digits(e.target.value)) : "")} className="field text-right tabular-nums" />
          </div>
          <div className="md:col-span-2 flex items-center justify-end gap-2 text-sm">
            <span className="text-ink-soft">마진</span>
            <span className={`text-lg font-bold tabular-nums ${margin < 0 ? "text-danger" : ""}`}>{won(margin)}원</span>
            {digits(sale) > 0 && <span className="text-xs text-ink-soft">({Math.round((margin / digits(sale)) * 100)}%)</span>}
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="memo">메모</label>
            <textarea id="memo" name="memo" rows={2} defaultValue={initial.memo ?? ""} className="field" />
          </div>
        </div>
      </fieldset>
      <Message state={state} />
      {!readOnly && (
        <button className="btn" disabled={pending || !clientId}>
          {pending ? "저장 중…" : submitLabel}
        </button>
      )}
    </form>
  );
}

export type StatusValues = {
  payment_received: boolean;
  payment_note: string | null;
  invoice_status: string;
  invoice_issued_at: string | null;
  partner_paid: boolean;
  partner_paid_amount: number | null;
  partner_invoice_amount: number | null;
};

export function ViralStatusForm({ action, initial, readOnly }: { action: Action; initial: StatusValues; readOnly: boolean }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [invoice, setInvoice] = useState(initial.invoice_status);
  return (
    <form action={formAction} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4 text-sm">
        <div>
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" name="payment_received" defaultChecked={initial.payment_received} /> 고객 입금 확인
          </label>
          <input name="payment_note" placeholder="예: 홍길동 132,000 입금" defaultValue={initial.payment_note ?? ""} className="field mt-2" aria-label="입금 메모" />
        </div>
        <div>
          <label className="label" htmlFor="invoice_status">고객 세금계산서</label>
          <select id="invoice_status" name="invoice_status" value={invoice} onChange={(e) => setInvoice(e.target.value)} className="field">
            <option value="not_issued">미발행</option>
            <option value="requested">발행 요청함</option>
            <option value="issued">발행 완료</option>
            <option value="not_needed">발행 안 함</option>
          </select>
          {invoice === "issued" && (
            <input name="invoice_issued_at" type="date" defaultValue={initial.invoice_issued_at ?? todayKST()} className="field mt-2" aria-label="발행일" />
          )}
        </div>
        <div>
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" name="partner_paid" defaultChecked={initial.partner_paid} /> 협력사 결제 완료
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input name="partner_paid_amount" inputMode="numeric" placeholder="협력사에 보낸 금액" defaultValue={initial.partner_paid_amount ?? ""} className="field text-right" aria-label="협력사에 보낸 금액" />
            <input name="partner_invoice_amount" inputMode="numeric" placeholder="협력사 계산서 금액" defaultValue={initial.partner_invoice_amount ?? ""} className="field text-right" aria-label="협력사 세금계산서 금액" />
          </div>
        </div>
      </fieldset>
      <Message state={state} />
      {!readOnly && <button className="btn btn-ghost" disabled={pending}>{pending ? "저장 중…" : "상태 저장"}</button>}
    </form>
  );
}
