"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { formatBizNo } from "@/lib/bizno";
import { defaultSale, describeItem, endDate, findPrice, lineAmounts, PLATFORMS, PRODUCT_TYPES, SLOT_DAYS, type PriceRow } from "@/lib/viral-products";
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
  cost_amount?: number | null;
  sale_amount: number;
  incentive_excluded?: boolean;
  product_type?: string | null;
  platform?: string | null;
  product_name?: string | null;
  days?: number | null;
  quantity?: number | null;
};

export type OrderValues = {
  client_id?: string;
  brand_id?: string | null;
  partner_id?: string;
  paid_date?: string | null;
  derived_staff_id?: string | null;
  staff_id?: string | null;
  staff_name?: string | null;
  memo?: string | null;
  items?: ItemValues[];
};

// 화면에서 줄을 구분하는 번호 (저장되지 않음)
let keySeq = 0;
const newKey = () => `row-${++keySeq}`;

type ItemDraft = {
  key: string;
  id?: string;
  type: string; // 상품 종류
  platform: string; // 네이버·쿠팡·인스타 또는 직접 입력한 값
  productName: string; // 협력사 상품명 (예: 메이크)
  days: string; // "10" | "20" | "30" | 직접 입력 숫자
  customDays: boolean;
  qty: string;
  description: string;
  descTouched: boolean; // 설명을 직접 고쳤으면 자동 설명으로 덮지 않음
  start_date: string;
  end_date: string;
  cost: string;
  sale: string;
  amountsManual: boolean; // 금액을 직접 고쳤으면 단가표로 덮지 않음
  saleManual: boolean; // 판매가를 직접 고쳤으면 '공급가 ÷ 0.7' 자동 판매가로 덮지 않음
  excluded: boolean;
  excludedTouched: boolean;
};

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
  prices = [],
  meId,
  canViewCost = false,
}: {
  action: Action;
  clients: ClientOption[];
  partners: { id: string; name: string }[];
  initial?: OrderValues;
  submitLabel: string;
  readOnly?: boolean;
  staff?: { id: string; name: string }[];
  canSetDerived?: boolean;
  prices?: PriceRow[];
  meId?: string;
  canViewCost?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [clientId, setClientId] = useState(initial.client_id ?? "");
  const [q, setQ] = useState("");
  const [partnerId, setPartnerId] = useState(initial.partner_id ?? "");
  const toDraft = (i: ItemValues): ItemDraft => ({
    key: i.id ?? newKey(),
    id: i.id,
    type: i.product_type ?? "",
    platform: i.platform ?? "",
    productName: i.product_name ?? "",
    days: i.days ? String(i.days) : "",
    customDays: !!i.days && !SLOT_DAYS.includes(i.days),
    qty: i.quantity != null ? String(Number(i.quantity)) : "",
    description: i.description ?? "",
    descTouched: true,
    start_date: i.start_date ?? "",
    end_date: i.end_date ?? "",
    cost: i.cost_amount ? won(i.cost_amount) : "",
    sale: won(i.sale_amount ?? 0),
    amountsManual: true,
    saleManual: true,
    excluded: !!i.incentive_excluded,
    excludedTouched: true,
  });
  const blank = (): ItemDraft => ({
    key: newKey(), type: "", platform: "네이버", productName: "", days: "", customDays: false, qty: "", description: "", descTouched: false,
    start_date: "", end_date: "", cost: "", sale: "", amountsManual: false, saleManual: false, excluded: false, excludedTouched: false,
  });
  const [items, setItems] = useState<ItemDraft[]>(initial.items?.length ? initial.items.map(toDraft) : [blank()]);

  // 한 줄의 값이 바뀌면: 끝나는 날·설명·인센티브 제외·단가표 금액을 다시 맞춤
  const refresh = (x: ItemDraft, pid: string): ItemDraft => {
    const days = Number(x.days) || 0;
    const next = { ...x };
    if (x.start_date && days) next.end_date = endDate(x.start_date, days);
    if (!x.descTouched && x.type)
      next.description = describeItem({ product_type: x.type, product_name: x.productName, days: days || null, quantity: Number(x.qty) || null, start_date: x.start_date || null, end_date: next.end_date || null });
    if (!x.excludedTouched) next.excluded = x.type === "가구매 제품비" || /제품비/.test(next.description);
    const price = x.type && pid ? findPrice(prices, { partnerId: pid, productType: x.type, platform: x.platform, productName: x.productName, days: days || null }) : null;
    if (!x.amountsManual && price && Number(x.qty) > 0) {
      const a = lineAmounts(price, Number(x.qty));
      if (a.cost != null) next.cost = won(a.cost);
      next.sale = won(a.sale);
    } else if (!price && canViewCost && !x.saleManual && digits(next.cost) > 0) {
      // 단가표에 없는 상품: 고객 판매가(VAT 포함) = 공급가 ÷ 0.7 (100원 미만 버림) → 저장은 VAT 별도
      next.sale = won(Math.round(defaultSale(digits(next.cost)) / 1.1));
    }
    return next;
  };
  const setItem = (key: string, patch: Partial<ItemDraft>) => setItems((xs) => xs.map((x) => (x.key === key ? refresh({ ...x, ...patch }, partnerId) : x)));
  const priceFor = (x: ItemDraft) =>
    partnerId && x.type ? findPrice(prices, { partnerId, productType: x.type, platform: x.platform, productName: x.productName, days: Number(x.days) || null }) : null;
  const client = clients.find((c) => c.id === clientId);
  // 판매가는 VAT 별도, 공급가는 VAT 포함 → 공급가에서 VAT를 빼고 비교 (데이터베이스 계산과 같음)
  const totalSale = items.reduce((t, i) => t + digits(i.sale), 0);
  const totalCost = items.reduce((t, i) => t + digits(i.cost), 0);
  const costNet = items.reduce((t, i) => t + Math.round(digits(i.cost) / 1.1), 0);
  const margin = totalSale - costNet;
  const excludedSale = items.filter((i) => i.excluded).reduce((t, i) => t + digits(i.sale), 0);
  const itemsJson = JSON.stringify(
    items.map((i, idx) => ({
      id: i.id,
      sort_order: idx,
      description: i.description.trim() || null,
      start_date: i.start_date || null,
      end_date: i.end_date || null,
      ...(canViewCost ? { cost_amount: digits(i.cost) } : {}),
      sale_amount: digits(i.sale),
      incentive_excluded: i.excluded,
      product_type: i.type || null,
      platform: i.platform.trim() || null,
      product_name: i.productName.trim() || null,
      days: Number(i.days) || null,
      quantity: i.qty === "" ? null : Number(i.qty),
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
            <select
              id="partner_id"
              name="partner_id"
              required
              value={partnerId}
              onChange={(e) => {
                const pid = e.target.value;
                setPartnerId(pid);
                setItems((xs) => xs.map((x) => refresh(x, pid)));
              }}
              className="field"
            >
              <option value="" disabled>골라 주세요</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="paid_date">입금일</label>
            <input id="paid_date" name="paid_date" type="date" defaultValue={initial.client_id ? (initial.paid_date ?? "") : todayKST()} className="field" />
            <p className="mt-1 text-xs text-ink-soft">입금 전이면 비워 두세요. 입금되면 날짜를 넣고 상태에서 &lsquo;입금 확인&rsquo;을 체크합니다.</p>
          </div>
          <div>
            <label className="label" htmlFor="staff_id">담당자</label>
            <select id="staff_id" name="staff_id" defaultValue={initial.staff_id ?? meId ?? ""} className="field">
              {canSetDerived
                ? staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)
                : staff.filter((p) => p.id === meId || p.id === initial.staff_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {initial.staff_id && !staff.some((p) => p.id === initial.staff_id) && <option value={initial.staff_id}>{initial.staff_name ?? "(퇴사)"}</option>}
            </select>
            {!canSetDerived && <p className="mt-1 text-xs text-ink-soft">다른 직원을 담당으로 바꾸는 것은 대표·팀장이 합니다.</p>}
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
              <span className="text-xs text-ink-soft">공급가는 VAT 포함, 판매가는 VAT 별도 (인센티브는 판매가 VAT 별도로 계산)</span>
            </div>
            <div className="space-y-3">
              {items.map((it, idx) => {
                const price = priceFor(it);
                const n = idx + 1;
                const isSlot = it.type === "슬롯";
                const otherPlatform = !!it.platform && !PLATFORMS.includes(it.platform);
                return (
                <div key={it.key} className="space-y-2 rounded-xl border border-[var(--glass-border)] bg-white/60 p-3">
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
                    <select value={it.type} onChange={(e) => setItem(it.key, { type: e.target.value })} className="field" aria-label={`상품 ${n} 종류`}>
                      <option value="">상품 종류 선택</option>
                      {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div className="flex gap-1">
                      <select
                        value={otherPlatform || it.platform === "기타" ? "기타" : it.platform}
                        onChange={(e) => setItem(it.key, { platform: e.target.value === "기타" ? "기타" : e.target.value })}
                        className="field"
                        aria-label={`상품 ${n} 적용 매체`}
                      >
                        <option value="">매체</option>
                        {PLATFORMS.map((m) => <option key={m} value={m}>{m}</option>)}
                        <option value="기타">기타 (직접 입력)</option>
                      </select>
                      {(otherPlatform || it.platform === "기타") && (
                        <input value={it.platform === "기타" ? "" : it.platform} onChange={(e) => setItem(it.key, { platform: e.target.value || "기타" })} placeholder="매체 이름" className="field" aria-label={`상품 ${n} 매체 직접 입력`} />
                      )}
                    </div>
                    <input value={it.productName} onChange={(e) => setItem(it.key, { productName: e.target.value })} placeholder="협력사 상품명 (예: 메이크)" list={`names-${it.key}`} className="field" aria-label={`상품 ${n} 협력사 상품명`} />
                    <datalist id={`names-${it.key}`}>
                      {[...new Set(prices.filter((p) => p.partner_id === partnerId && (!it.type || p.product_type === it.type) && p.product_name).map((p) => p.product_name as string))].map((nm) => <option key={nm} value={nm} />)}
                    </datalist>
                    <div className="flex gap-1">
                      <input inputMode="decimal" value={it.qty} onChange={(e) => setItem(it.key, { qty: e.target.value.replace(/[^\d.]/g, "") })} placeholder={isSlot ? "슬롯 수" : "수량(건)"} className="field text-right" aria-label={`상품 ${n} 수량`} />
                      <span className="self-center whitespace-nowrap text-xs text-ink-soft">{isSlot ? "슬롯" : "건"}</span>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-[1fr_140px_140px]">
                    {isSlot ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {SLOT_DAYS.map((d) => (
                          <button key={d} type="button" onClick={() => setItem(it.key, { days: String(d), customDays: false })} className={`rounded-lg border px-3 py-2 text-sm ${!it.customDays && it.days === String(d) ? "border-brand bg-brand text-white" : "border-[var(--glass-border)] bg-white"}`}>{d}일</button>
                        ))}
                        <button type="button" onClick={() => setItem(it.key, { customDays: true })} className={`rounded-lg border px-3 py-2 text-sm ${it.customDays ? "border-brand bg-brand-soft" : "border-[var(--glass-border)] bg-white"}`}>직접</button>
                        {it.customDays && <input inputMode="numeric" value={it.days} onChange={(e) => setItem(it.key, { days: e.target.value.replace(/[^\d]/g, "") })} placeholder="일수" className="field w-20 text-right" aria-label={`상품 ${n} 일수`} />}
                      </div>
                    ) : (
                      <input inputMode="numeric" value={it.days} onChange={(e) => setItem(it.key, { days: e.target.value.replace(/[^\d]/g, ""), customDays: true })} placeholder="진행 일수 (선택)" className="field" aria-label={`상품 ${n} 일수`} />
                    )}
                    <input type="date" value={it.start_date} onChange={(e) => setItem(it.key, { start_date: e.target.value })} className="field" aria-label={`상품 ${n} 시작일`} />
                    <input type="date" value={it.end_date} onChange={(e) => setItem(it.key, { end_date: e.target.value })} className="field" aria-label={`상품 ${n} 끝나는 날`} />
                  </div>
                  <input value={it.description} onChange={(e) => setItem(it.key, { description: e.target.value, descTouched: true })} placeholder={`상품 ${n} 내용 (종류·일수·수량을 고르면 자동으로 채워짐)`} className="field" aria-label={`상품 ${n} 내용`} />
                  <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2 md:grid-cols-[1fr_1fr_1fr_auto_auto]">
                    {canViewCost ? (
                      <label className="flex items-center gap-2 text-xs text-ink-soft">
                        <span className="w-14 shrink-0">공급가<br />VAT포함</span>
                        <input inputMode="numeric" value={it.cost} onChange={(e) => setItem(it.key, { cost: e.target.value ? won(digits(e.target.value)) : "", amountsManual: true })} placeholder="0" className="field text-right tabular-nums" aria-label={`상품 ${n} 공급가`} />
                      </label>
                    ) : <span className="text-xs text-ink-soft">공급가는 단가표로 자동 입력</span>}
                    <label className="flex items-center gap-2 text-xs text-ink-soft">
                      <span className="w-14 shrink-0">판매가<br />VAT포함</span>
                      <input
                        inputMode="numeric"
                        value={it.sale ? won(Math.round(digits(it.sale) * 1.1)) : ""}
                        onChange={(e) => setItem(it.key, { sale: e.target.value ? won(Math.round(digits(e.target.value) / 1.1)) : "", amountsManual: true, saleManual: true })}
                        placeholder="0"
                        className="field text-right tabular-nums"
                        aria-label={`상품 ${n} 판매가 VAT 포함`}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-ink-soft">
                      <span className="w-14 shrink-0">판매가<br />VAT별도</span>
                      <input inputMode="numeric" value={it.sale} onChange={(e) => setItem(it.key, { sale: e.target.value ? won(digits(e.target.value)) : "", amountsManual: true, saleManual: true })} placeholder="0" className="field text-right tabular-nums" aria-label={`상품 ${n} 판매가`} />
                    </label>
                    <label className="flex items-center gap-1 whitespace-nowrap text-xs text-ink-soft" title="제품비 같은 실비는 인센티브에서 뺍니다">
                      <input type="checkbox" checked={it.excluded} onChange={(e) => setItem(it.key, { excluded: e.target.checked, excludedTouched: true })} aria-label={`상품 ${n} 인센티브 제외`} />
                      인센티브 제외
                    </label>
                    {!readOnly && items.length > 1 ? (
                      <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))} className="px-2 text-sm text-ink-soft hover:text-danger" aria-label={`상품 ${n} 지우기`}>삭제</button>
                    ) : <span />}
                  </div>
                  <p className="text-xs text-ink-soft">
                    {digits(it.sale) !== 0 && (
                      <>
                        판매가(VAT 포함) {won(Math.round(digits(it.sale) * 1.1))}원 · 실제 인센티브 집행 비용 <b className="text-ink">{won(it.excluded ? 0 : digits(it.sale))}원</b>(VAT 별도) ·{" "}
                      </>
                    )}
                    {price ? (
                      <>
                        단가표: 1{price.unit_label}당 {price.cost_price != null && <>공급가 {won(price.cost_price)} / </>}판매가 {won(price.sale_price)}({price.sale_includes_vat ? "VAT 포함" : "VAT 별도"})
                        {it.amountsManual && !readOnly && (
                          <button type="button" className="ml-2 text-brand underline" onClick={() => setItem(it.key, { amountsManual: false })}>단가표 금액으로 다시 계산</button>
                        )}
                      </>
                    ) : it.type && partnerId ? (
                      canViewCost ? "단가표에 없는 상품 · 공급가를 넣으면 판매가(VAT 포함) = 공급가 ÷ 0.7 (100원 미만 버림)" : "단가표에 없는 상품 · 판매가를 직접 입력하세요 (VAT 포함·별도 중 편한 칸에)"
                    ) : null}
                  </p>
                </div>
                );
              })}
            </div>
            {!readOnly && (
              <button type="button" onClick={() => setItems((xs) => [...xs, blank()])} className="btn btn-ghost mt-3">+ 상품 줄 추가</button>
            )}
          </div>
          <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm">
            <span className="mr-auto text-xs text-ink-soft">상품 {items.length}줄{canViewCost && <> · 공급가 합계 {won(totalCost)}원 (VAT 별도 {won(costNet)}원)</>}</span>
            <span className="text-ink-soft">판매가 합계</span>
            <span className="font-bold tabular-nums">{won(totalSale)}원</span>
            <span className="text-xs text-ink-soft">(VAT 포함 {won(Math.round(totalSale * 1.1))}원)</span>
            {canViewCost && (
              <>
                <span className="text-ink-soft">마진</span>
                <span className={`text-lg font-bold tabular-nums ${margin < 0 ? "text-danger" : ""}`}>{won(margin)}원</span>
                {totalSale > 0 && <span className="text-xs text-ink-soft">({Math.round((margin / totalSale) * 100)}%)</span>}
              </>
            )}
            {excludedSale !== 0 && <span className="w-full text-right text-xs text-[var(--warn-ink)]">인센티브 제외 {won(excludedSale)}원 → 인센티브 반영 판매가 {won(totalSale - excludedSale)}원</span>}
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
  partner_paid_amount?: number | null;
  partner_invoice_amount?: number | null;
};

export function ViralStatusForm({ action, initial, readOnly, canViewCost = false }: { action: Action; initial: StatusValues; readOnly: boolean; canViewCost?: boolean }) {
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
          {canViewCost && <div className="mt-2 grid grid-cols-2 gap-2">
            <input name="partner_paid_amount" inputMode="numeric" placeholder="협력사에 보낸 금액" defaultValue={initial.partner_paid_amount ?? ""} className="field text-right" aria-label="협력사에 보낸 금액" />
            <input name="partner_invoice_amount" inputMode="numeric" placeholder="협력사 계산서 금액" defaultValue={initial.partner_invoice_amount ?? ""} className="field text-right" aria-label="협력사 세금계산서 금액" />
          </div>}
        </div>
      </fieldset>
      <Message state={state} />
      {!readOnly && <button className="btn btn-ghost" disabled={pending}>{pending ? "저장 중…" : "상태 저장"}</button>}
    </form>
  );
}

// 환불 · 미소진 기록 추가
export function CreditForm({ action, items }: { action: Action; items: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [entry, setEntry] = useState("refund_issued");
  const [amount, setAmount] = useState("");
  return (
    <form action={formAction} className="space-y-2 text-sm">
      <select name="entry" value={entry} onChange={(e) => setEntry(e.target.value)} className="field" aria-label="기록 종류">
        <optgroup label="환불 (작업 미흡 등으로 돌려줄 금액)">
          <option value="refund_issued">환불 발생 — 돌려줄 금액이 생김</option>
          <option value="refund_paid">환급 지급 — 고객에게 돌려줌</option>
          <option value="refund_applied">다음 건에서 차감 — 이번에 덜 받음</option>
        </optgroup>
        <optgroup label="미소진 (판매가보다 더 받아 둔 금액)">
          <option value="prepaid_received">미소진 발생 — 판매가보다 더 받음</option>
          <option value="prepaid_used">미소진 사용 — 서비스 작업 등에 씀</option>
        </optgroup>
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input
          name="amount"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value ? won(Math.abs(digits(e.target.value))) : "")}
          placeholder="금액 (VAT 별도)"
          className="field text-right tabular-nums"
          aria-label="금액 (VAT 별도)"
        />
        <input name="occurred_on" type="date" defaultValue={todayKST()} className="field" aria-label="날짜" />
      </div>
      {entry === "refund_issued" && (
        <>
          {items.length > 1 && (
            <select name="item_id" defaultValue="" className="field" aria-label="환불 상품">
              <option value="">건 전체</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          )}
          <input name="partner_refund" inputMode="numeric" placeholder="협력사에서 돌려받는 금액 (VAT 포함, 없으면 비움)" className="field text-right" aria-label="협력사 환불 금액" />
        </>
      )}
      <input name="memo" placeholder={entry.startsWith("prepaid") ? "예: 리뷰 10건 서비스 진행" : "예: 순위 미달 5일분"} className="field" aria-label="메모" />
      <button className="btn btn-ghost w-full" disabled={pending}>{pending ? "…" : "기록 추가"}</button>
      <Message state={state} />
    </form>
  );
}

// 단가 한 줄 추가·수정
export function PriceForm({ action, partners, initial, submitLabel }: {
  action: Action;
  partners: { id: string; name: string }[];
  initial?: Partial<PriceRow> & { memo?: string | null };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-1">
      <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-[1fr_1.2fr_0.7fr_1.4fr_0.5fr_0.5fr_0.9fr_1.4fr_auto]">
        <select name="partner_id" defaultValue={initial?.partner_id ?? ""} className="field" aria-label="협력사" required>
          <option value="">협력사</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select name="product_type" defaultValue={initial?.product_type ?? ""} className="field" aria-label="상품 종류" required>
          <option value="">상품 종류</option>
          {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input name="platform" defaultValue={initial?.platform ?? ""} placeholder="매체(공통)" list="price-platforms" className="field" aria-label="매체" />
        <input name="product_name" defaultValue={initial?.product_name ?? ""} placeholder="상품명(공통)" className="field" aria-label="협력사 상품명" />
        <input name="days" inputMode="numeric" defaultValue={initial?.days ?? ""} placeholder="일수" className="field text-right" aria-label="일수" />
        <input name="unit_label" defaultValue={initial?.unit_label ?? ""} placeholder="단위" className="field" aria-label="단위 (슬롯·건)" />
        <input name="cost_price" inputMode="numeric" defaultValue={initial?.cost_price ?? ""} placeholder="공급가 VAT포함" className="field text-right" aria-label="1개당 공급가 (VAT 포함)" required />
        <div className="flex gap-1">
          <input name="sale_price" inputMode="numeric" defaultValue={initial?.sale_price ?? ""} placeholder="판매가" className="field text-right" aria-label="1개당 판매가" required />
          <select name="sale_vat_mode" defaultValue={initial?.sale_includes_vat ? "included" : "excluded"} className="field w-24 px-1 text-xs" aria-label="판매가 VAT">
            <option value="excluded">VAT 별도</option>
            <option value="included">VAT 포함</option>
          </select>
        </div>
        <button className="btn btn-ghost" disabled={pending}>{pending ? "…" : submitLabel}</button>
      </div>
      <datalist id="price-platforms">{PLATFORMS.map((m) => <option key={m} value={m} />)}</datalist>
      <Message state={state} />
    </form>
  );
}
