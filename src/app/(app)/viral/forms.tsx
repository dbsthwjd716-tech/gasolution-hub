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

export type ItemValues = {
  id?: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  cost_amount: number;
  sale_amount: number;
};

export type OrderValues = {
  client_id?: string;
  brand_id?: string | null;
  partner_id?: string;
  paid_date?: string | null;
  derived_staff_id?: string | null;
  memo?: string | null;
  items?: ItemValues[];
};

// 화면에서 줄을 구분하는 번호 (저장되지 않음)
let keySeq = 0;
const newKey = () => `row-${++keySeq}`;

type ItemDraft = { key: string; id?: string; description: string; start_date: string; end_date: string; cost: string; sale: string };

const won = (n: number) => n.toLocaleString("ko-KR");
// 한국 시간 기준 오늘 (YYYY-MM-DD)
const todayKST = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
// 숫자만 남김 (맨 앞 - 는 환불·취소 표시로 유지)
const digits = (v: string) => (v.trim().startsWith("-") ? -1 : 1) * Number(v.replace(/[^\d]/g, "") || 0);
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
  staff = [],
  canSetDerived = false,
}: {
  action: Action;
  clients: ClientOption[];
  partners: { id: string; name: string }[];
  initial?: OrderValues;
  submitLabel: string;
  readOnly?: boolean;
  staff?: { id: string; name: string }[];
  canSetDerived?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [clientId, setClientId] = useState(initial.client_id ?? "");
  const [q, setQ] = useState("");
  const toDraft = (i: ItemValues): ItemDraft => ({
    key: i.id ?? newKey(),
    id: i.id,
    description: i.description ?? "",
    start_date: i.start_date ?? "",
    end_date: i.end_date ?? "",
    cost: i.cost_amount ? won(i.cost_amount) : "",
    sale: won(i.sale_amount ?? 0),
  });
  const blank = (): ItemDraft => ({ key: newKey(), description: "", start_date: "", end_date: "", cost: "", sale: "" });
  const [items, setItems] = useState<ItemDraft[]>(initial.items?.length ? initial.items.map(toDraft) : [blank()]);
  const setItem = (key: string, patch: Partial<ItemDraft>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const client = clients.find((c) => c.id === clientId);
  // 판매가는 VAT 별도, 공급가는 VAT 포함 → 공급가에서 VAT를 빼고 비교 (데이터베이스 계산과 같음)
  const totalSale = items.reduce((t, i) => t + digits(i.sale), 0);
  const totalCost = items.reduce((t, i) => t + digits(i.cost), 0);
  const costNet = items.reduce((t, i) => t + Math.round(digits(i.cost) / 1.1), 0);
  const margin = totalSale - costNet;
  const itemsJson = JSON.stringify(
    items.map((i, idx) => ({
      id: i.id,
      sort_order: idx,
      description: i.description.trim() || null,
      start_date: i.start_date || null,
      end_date: i.end_date || null,
      cost_amount: digits(i.cost),
      sale_amount: digits(i.sale),
    })),
  );

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
      <input type="hidden" name="items" value={itemsJson} />
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
            <label className="label" htmlFor="paid_date">입금일</label>
            <input id="paid_date" name="paid_date" type="date" defaultValue={initial.client_id ? (initial.paid_date ?? "") : todayKST()} className="field" />
            <p className="mt-1 text-xs text-ink-soft">입금 전이면 비워 두세요. 입금되면 날짜를 넣고 상태에서 &lsquo;입금 확인&rsquo;을 체크합니다.</p>
          </div>
          {(canSetDerived || initial.derived_staff_id) && (
            <div>
              <label className="label" htmlFor="derived_staff_id">파생 실적자</label>
              <select id="derived_staff_id" name="derived_staff_id" defaultValue={initial.derived_staff_id ?? ""} disabled={!canSetDerived} className="field">
                <option value="">없음</option>
                {staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-soft">다른 담당의 건에서 파생 실적을 받는 사람 (대표·팀장만 지정)</p>
            </div>
          )}

          <div className="md:col-span-2">
            <div className="mb-2 flex items-end justify-between">
              <span className="label mb-0">상품 (슬롯·상품별로 한 줄씩)</span>
              <span className="text-xs text-ink-soft">공급가는 VAT 포함, 판매가는 VAT 별도 · 환불은 -로 입력</span>
            </div>
            <div className="space-y-3">
              {items.map((it, idx) => (
                <div key={it.key} className="rounded-xl border border-[var(--glass-border)] bg-white/60 p-3">
                  <div className="grid gap-2 md:grid-cols-[1fr_140px_140px]">
                    <input value={it.description} onChange={(e) => setItem(it.key, { description: e.target.value })} placeholder={`상품 ${idx + 1} 내용 (예: 우상향 30슬롯 4스타세트)`} className="field" aria-label={`상품 ${idx + 1} 내용`} />
                    <input type="date" value={it.start_date} onChange={(e) => setItem(it.key, { start_date: e.target.value })} className="field" aria-label={`상품 ${idx + 1} 시작일`} />
                    <input type="date" value={it.end_date} onChange={(e) => setItem(it.key, { end_date: e.target.value })} className="field" aria-label={`상품 ${idx + 1} 끝나는 날`} />
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-ink-soft">
                      <span className="w-14 shrink-0">공급가<br />VAT포함</span>
                      <input inputMode="numeric" value={it.cost} onChange={(e) => setItem(it.key, { cost: e.target.value ? won(digits(e.target.value)) : "" })} placeholder="0" className="field text-right tabular-nums" aria-label={`상품 ${idx + 1} 공급가`} />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-ink-soft">
                      <span className="w-14 shrink-0">판매가<br />VAT별도</span>
                      <input inputMode="numeric" value={it.sale} onChange={(e) => setItem(it.key, { sale: e.target.value ? won(digits(e.target.value)) : "" })} placeholder="0" className="field text-right tabular-nums" aria-label={`상품 ${idx + 1} 판매가`} />
                    </label>
                    {!readOnly && items.length > 1 ? (
                      <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))} className="px-2 text-sm text-ink-soft hover:text-danger" aria-label={`상품 ${idx + 1} 지우기`}>삭제</button>
                    ) : <span />}
                  </div>
                </div>
              ))}
            </div>
            {!readOnly && (
              <button type="button" onClick={() => setItems((xs) => [...xs, blank()])} className="btn btn-ghost mt-3">+ 상품 줄 추가</button>
            )}
          </div>
          <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm">
            <span className="mr-auto text-xs text-ink-soft">상품 {items.length}줄 · 공급가 합계 {won(totalCost)}원 (VAT 별도 {won(costNet)}원)</span>
            <span className="text-ink-soft">판매가 합계</span>
            <span className="font-bold tabular-nums">{won(totalSale)}원</span>
            <span className="text-ink-soft">마진</span>
            <span className={`text-lg font-bold tabular-nums ${margin < 0 ? "text-danger" : ""}`}>{won(margin)}원</span>
            {totalSale > 0 && <span className="text-xs text-ink-soft">({Math.round((margin / totalSale) * 100)}%)</span>}
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
