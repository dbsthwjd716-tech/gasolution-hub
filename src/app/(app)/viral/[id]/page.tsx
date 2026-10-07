import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBizNo } from "@/lib/bizno";
import { canViewCost, getMe } from "@/lib/supabase/server";
import { CREDIT_ENTRY_LABEL, viralRequestText } from "@/lib/viral-products";
import { ConfirmSubmit, CopyButton } from "../../billing/panel";
import { addViralCredit, createEstimateFromOrder, deleteViralCredit, updateViralOrder, updateViralStatus } from "../actions";
import { loadActiveStaff, loadClientOptions, loadPartners, loadPrices } from "../data";
import { CreditForm, ViralOrderForm, ViralStatusForm } from "../forms";

const won = (n: number) => Number(n).toLocaleString("ko-KR");

type Credit = { id: string; entry: string; kind: string; amount: number; partner_refund: number; occurred_on: string; memo: string | null; created_by: string | null; order_id: string | null };

export default async function ViralDetail(props: PageProps<"/viral/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  const { data: o } = await supabase.from("viral_orders_list").select("*").eq("id", id).maybeSingle();
  if (!o) notFound();

  const [clients, partners, staff, prices, { data: items }, { data: credits }, { data: balance }] = await Promise.all([
    loadClientOptions(supabase),
    loadPartners(supabase),
    loadActiveStaff(supabase),
    loadPrices(supabase),
    supabase
      .from("viral_order_items")
      .select("id,description,start_date,end_date,sale_amount,incentive_excluded,product_type,platform,product_name,days,quantity,source_sheet,source_row")
      .eq("order_id", id)
      .order("sort_order")
      .order("created_at"),
    supabase.from("viral_credits").select("id,entry,kind,amount,partner_refund,occurred_on,memo,created_by,order_id").eq("client_id", o.client_id).order("occurred_on", { ascending: false }).returns<Credit[]>(),
    supabase.from("viral_credit_balances").select("refund_balance,prepaid_balance").eq("client_id", o.client_id).maybeSingle(),
  ]);
  // 퇴사 직원이 파생 실적자인 예전 건도 이름이 보이게
  if (o.derived_staff_id && !staff.some((x) => x.id === o.derived_staff_id))
    staff.push({ id: o.derived_staff_id, name: o.derived_staff_name ?? "(퇴사)" });
  // 종료된 거래처라도 이 건의 거래처는 보이게
  if (!clients.some((c) => c.id === o.client_id)) {
    clients.push({
      id: o.client_id,
      company_name: o.company_name,
      business_number: o.business_number,
      representative_name: o.representative_name,
      address: o.address,
      billing_emails: o.billing_emails ?? [],
      has_registration: o.has_registration,
      aliases: [],
      brands: o.brand_id ? [{ id: o.brand_id, name: o.brand_name }] : [],
    });
  }
  const isManager = me?.role === "ceo" || me?.role === "lead";
  // 공급가·마진·협력사 결제 금액은 권한 있는 사람에게만 (데이터베이스 함수가 다시 확인)
  const showCost = canViewCost(me);
  type OrderCost = { cost_amount: number; margin_amount: number; partner_paid_amount: number | null; partner_invoice_amount: number | null };
  let orderCost: OrderCost | null = null;
  const itemCost = new Map<string, number>();
  if (showCost) {
    const [{ data: oc }, { data: ic }] = await Promise.all([
      supabase.rpc("viral_order_costs", { ids: [id] }),
      supabase.rpc("viral_item_costs", { oid: id }),
    ]);
    orderCost = ((oc ?? []) as OrderCost[])[0] ?? null;
    for (const c of (ic ?? []) as { id: string; cost_amount: number }[]) itemCost.set(c.id, Number(c.cost_amount));
  }
  const canEdit = !!me && (isManager || o.staff_id === me.id);
  const rows = (items ?? []).map((i) => ({ ...i, cost_amount: showCost ? (itemCost.get(i.id) ?? 0) : undefined }));
  const mine = (credits ?? []).filter((c) => c.order_id === id);
  const others = (credits ?? []).filter((c) => c.order_id !== id).slice(0, 6);
  const text = viralRequestText({
    paidDate: o.paid_date,
    company: o.company_name,
    representative: o.representative_name,
    businessNumber: formatBizNo(o.business_number) || null,
    emails: o.billing_emails ?? [],
    hasRegistration: o.has_registration,
    items: rows.map((i) => ({ description: i.description, product_type: i.product_type, platform: i.platform, sale_amount: Number(i.sale_amount), start_date: i.start_date, end_date: i.end_date })),
  });
  const sign = (e: string) => (e === "refund_issued" || e === "prepaid_received" ? "+" : "−");

  return (
    <div className="space-y-4">
      <Link href="/viral" className="text-sm text-ink-soft hover:text-brand">← 바이럴 목록</Link>
      {sp.estimate_error === "1" && <p className="glass p-3 text-sm text-danger">견적서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}
      <header className="glass flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h1 className="text-xl font-bold">{o.company_name} · {o.partner_name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {o.paid_date ? `입금 ${o.paid_date}` : "입금 전"} · 담당 {o.staff_name ?? "미지정"}
            {o.derived_staff_name && <span className="ml-2 chip chip-info">파생 · {o.derived_staff_name}</span>}
            {o.source_sheet && (
              <span className="ml-2 chip chip-muted">
                시트 {o.source_sheet} {rows.map((i) => i.source_row).filter(Boolean).join("·")}행에서 옮김
              </span>
            )}
          </p>
          <p className="mt-1 text-sm">
            판매가 <b className="tabular-nums">{won(o.sale_amount)}원</b> <span className="text-ink-soft">(VAT 포함 {won(Math.round(o.sale_amount * 1.1))}원)</span>
            {showCost && orderCost && <>{" · "}공급가 <span className="tabular-nums">{won(orderCost.cost_amount)}원</span> · 마진 <span className="tabular-nums">{won(orderCost.margin_amount)}원</span></>}
            {" · "}<span className={o.payment_received ? "text-[var(--ok-ink)]" : "text-[var(--warn-ink)]"}>{o.payment_received ? "입금 확인" : "입금 전"}</span>
            {" · "}<span className={o.partner_paid ? "text-[var(--ok-ink)]" : "text-[var(--warn-ink)]"}>{o.partner_paid ? "협력사 결제 완료" : "협력사 미결제"}</span>
          </p>
        </div>
        {!canEdit && <span className="chip chip-muted">보기 전용 · 담당자나 팀장만 수정할 수 있습니다</span>}
      </header>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="glass p-5">
          <h2 className="mb-4 font-bold">건 정보</h2>
          <ViralOrderForm action={updateViralOrder.bind(null, id)} clients={clients} partners={partners} prices={prices} initial={{ ...o, items: rows }} staff={staff} canSetDerived={isManager} meId={me?.id} canViewCost={showCost} submitLabel="저장" readOnly={!canEdit} />
        </section>
        <div className="space-y-4">
          <section className="glass h-fit p-5">
            <h2 className="mb-4 font-bold">진행 상태</h2>
            <ViralStatusForm action={updateViralStatus.bind(null, id)} initial={{ ...o, ...(orderCost ?? {}) }} readOnly={!canEdit} canViewCost={showCost} />
          </section>

          <section className="glass space-y-3 p-5">
            <h2 className="font-bold">견적서 · 세금계산서 발행요청</h2>
            {o.billing_document_id ? (
              <Link href={`/billing/${o.billing_document_id}`} className="btn btn-ghost w-full">연결된 견적서 보기</Link>
            ) : canEdit ? (
              <form action={createEstimateFromOrder.bind(null, id)}>
                <button className="btn w-full">이 건으로 견적서 만들기</button>
              </form>
            ) : null}
            <textarea readOnly value={text} rows={11} className="field font-mono text-xs" aria-label="발행요청 문구" />
            <CopyButton text={text} label="발행요청 문구 복사" />
          </section>

          <section className="glass space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">환불 · 미소진</h2>
              <Link href="/viral/balances" className="text-xs text-brand underline">업체별 잔액 보기</Link>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-white/70 p-3"><p className="text-xs text-ink-soft">{o.company_name} 환불 잔액</p><p className="font-bold tabular-nums">{won(balance?.refund_balance ?? 0)}원</p></div>
              <div className="rounded-xl bg-white/70 p-3"><p className="text-xs text-ink-soft">미소진 잔액</p><p className="font-bold tabular-nums">{won(balance?.prepaid_balance ?? 0)}원</p></div>
            </div>
            <ul className="space-y-1 text-sm">
              {mine.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 border-t border-[var(--glass-border)] pt-1">
                  <span>
                    <span className="tabular-nums text-xs text-ink-soft">{c.occurred_on}</span> {CREDIT_ENTRY_LABEL[c.entry]} <b className="tabular-nums">{sign(c.entry)}{won(c.amount)}</b>
                    {c.partner_refund > 0 && <span className="text-xs text-ink-soft"> · 협력사 환불 {won(c.partner_refund)}</span>}
                    {c.memo && <span className="block text-xs text-ink-soft">{c.memo}</span>}
                  </span>
                  {(isManager || c.created_by === me?.id) && <ConfirmSubmit action={deleteViralCredit.bind(null, id, c.id)} label="삭제" confirmText="이 기록을 지울까요?" />}
                </li>
              ))}
              {!mine.length && <li className="text-xs text-ink-soft">이 건의 환불·미소진 기록이 없습니다.</li>}
            </ul>
            {others.length > 0 && (
              <details className="text-xs text-ink-soft">
                <summary className="cursor-pointer">이 업체의 다른 건 기록 {others.length}개</summary>
                <ul className="mt-1 space-y-0.5">
                  {others.map((c) => (
                    <li key={c.id}>{c.occurred_on} {CREDIT_ENTRY_LABEL[c.entry]} {sign(c.entry)}{won(c.amount)} {c.order_id && <Link href={`/viral/${c.order_id}`} className="underline">건 보기</Link>}</li>
                  ))}
                </ul>
              </details>
            )}
            {canEdit && (
              <CreditForm
                action={addViralCredit.bind(null, id, o.client_id)}
                items={rows.map((i) => ({ id: i.id, label: i.description ?? i.product_type ?? "상품" }))}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
