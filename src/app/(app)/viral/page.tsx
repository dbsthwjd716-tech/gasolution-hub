import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { currentMonthKST } from "./data";

type Row = {
  id: string;
  paid_date: string | null;
  base_date: string;
  company_name: string;
  brand_name: string | null;
  is_provisional: boolean;
  description: string | null;
  partner_name: string;
  staff_name: string | null;
  staff_id: string | null;
  sale_amount: number;
  cost_amount: number;
  margin_amount: number;
  payment_received: boolean;
  invoice_status: "not_issued" | "requested" | "issued" | "not_needed";
  partner_paid: boolean;
  item_count: number;
  first_item_description: string | null;
  derived_staff_name: string | null;
};

const won = (n: number) => Number(n).toLocaleString("ko-KR");
const INVOICE: Record<Row["invoice_status"], { label: string; cls: string }> = {
  not_issued: { label: "미발행", cls: "chip-warn" },
  requested: { label: "요청함", cls: "chip-info" },
  issued: { label: "발행", cls: "chip-ok" },
  not_needed: { label: "안 함", cls: "chip-muted" },
};

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${ym}-01`, to: `${next}-01` };
}
function shiftMonth(ym: string, d: number) {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function ViralPage(props: PageProps<"/viral">) {
  const sp = await props.searchParams;
  const thisMonth = currentMonthKST();
  const ym = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : sp.m === "all" ? "all" : thisMonth;
  const tab = typeof sp.t === "string" ? sp.t : "all";
  const mine = sp.mine === "1";

  const { supabase, me } = await getMe();
  let query = supabase
    .from("viral_orders_view")
    .select("id,paid_date,base_date,company_name,brand_name,is_provisional,description,partner_name,staff_name,staff_id,sale_amount,cost_amount,margin_amount,payment_received,invoice_status,partner_paid,item_count,first_item_description,derived_staff_name")
    .order("base_date", { ascending: false })
    .limit(2000);
  // 미입금·미발행·미결제 목록은 달과 상관없이 밀린 건을 모두 보여줌
  if (ym !== "all" && tab === "all") {
    const r = monthRange(ym);
    query = query.gte("base_date", r.from).lt("base_date", r.to);
  }
  if (tab === "unpaid") query = query.eq("payment_received", false);
  if (tab === "invoice") query = query.in("invoice_status", ["not_issued", "requested"]);
  if (tab === "partner") query = query.eq("partner_paid", false);
  if (mine && me) query = query.eq("staff_id", me.id);
  const { data, error } = await query.returns<Row[]>();
  const rows = data ?? [];
  // 인센티브에서 빼는 줄(제품비 등)의 판매가를 건별로 모음
  const { data: ex } = await supabase.from("viral_order_items").select("order_id,sale_amount").eq("incentive_excluded", true);
  const shown = new Set(rows.map((r) => r.id));
  const excluded = new Map<string, number>();
  for (const e of ex ?? []) if (shown.has(e.order_id)) excluded.set(e.order_id, (excluded.get(e.order_id) ?? 0) + Number(e.sale_amount));
  const excludedTotal = [...excluded.values()].reduce((a, b) => a + b, 0);

  const sum = (k: "sale_amount" | "cost_amount" | "margin_amount") => rows.reduce((s, r) => s + Number(r[k]), 0);
  const tabs = [
    { t: "all", label: "전체" },
    { t: "unpaid", label: "입금 확인 전" },
    { t: "invoice", label: "세금계산서 미발행" },
    { t: "partner", label: "협력사 미결제" },
  ];
  const link = (o: Record<string, string | undefined>) => ({
    pathname: "/viral",
    query: Object.fromEntries(Object.entries({ m: ym, t: tab, mine: mine ? "1" : undefined, ...o }).filter(([, v]) => v)),
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">바이럴</h1>
          <p className="text-sm text-ink-soft">거래처를 고르면 업체 정보는 자동으로 들어갑니다. 구글 시트 대신 여기에 입력합니다.</p>
        </div>
        <div className="flex gap-2">
          {(me?.role === "ceo" || me?.role === "lead") && <Link href="/viral/import" className="btn btn-ghost">시트에서 옮기기</Link>}
          <Link href="/viral/new" className="btn">바이럴 건 입력</Link>
        </div>
      </header>

      <div className="glass flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <nav className="flex flex-wrap gap-1">
          {tabs.map((x) => (
            <Link key={x.t} href={link({ t: x.t })} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === x.t ? "bg-brand text-white" : "hover:bg-brand-soft"}`}>
              {x.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {tab === "all" && (
            <>
              {ym !== "all" && <Link href={link({ m: shiftMonth(ym, -1) })} className="btn btn-ghost px-3" aria-label="이전 달">‹</Link>}
              <span className="min-w-20 text-center font-semibold">{ym === "all" ? "전체 기간" : `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`}</span>
              {ym !== "all" && <Link href={link({ m: shiftMonth(ym, 1) })} className="btn btn-ghost px-3" aria-label="다음 달">›</Link>}
              <Link href={link({ m: ym === "all" ? thisMonth : "all" })} className="text-xs text-brand underline">{ym === "all" ? "이번 달" : "전체 기간"}</Link>
            </>
          )}
          <Link href={link({ mine: mine ? undefined : "1" })} className={`chip ${mine ? "chip-info" : "chip-muted"}`}>
            {mine ? "✓ 내 건만" : "내 건만"}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "건수", value: `${rows.length}건 (상품 ${rows.reduce((t, r) => t + (r.item_count || 0), 0)}줄)` },
          { label: "판매가 합계 (VAT 별도)", value: `${won(sum("sale_amount"))}원`, note: excludedTotal ? `인센티브 반영 ${won(sum("sale_amount") - excludedTotal)}원 (제품비 등 ${won(excludedTotal)}원 제외)` : "" },
          { label: "공급가 합계 (VAT 포함)", value: `${won(sum("cost_amount"))}원` },
          { label: "마진 합계 (VAT 별도)", value: `${won(sum("margin_amount"))}원` },
        ].map((k) => (
          <div key={k.label} className="glass p-4">
            <p className="text-xs text-ink-soft">{k.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p>
            {"note" in k && k.note && <p className="mt-1 text-xs text-ink-soft">{k.note}</p>}
          </div>
        ))}
      </div>

      {error && <p className="glass p-4 text-sm text-danger">목록을 불러오지 못했습니다: {error.message}</p>}

      <div className="glass overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr className="border-b border-[var(--glass-border)]">
              <th className="px-4 py-3">입금일</th>
              <th className="px-4 py-3">거래처</th>
              <th className="px-4 py-3">상품</th>
              <th className="px-4 py-3">협력사</th>
              <th className="px-4 py-3 text-right">판매가</th>
              <th className="px-4 py-3 text-right">마진</th>
              <th className="px-4 py-3">입금</th>
              <th className="px-4 py-3">계산서</th>
              <th className="px-4 py-3">협력사 결제</th>
              <th className="px-4 py-3">담당</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--glass-border)] last:border-0 hover:bg-white/60">
                <td className="px-4 py-3 tabular-nums">{r.paid_date ?? <span className="chip chip-warn">입금 전</span>}</td>
                <td className="px-4 py-3 font-semibold">
                  <Link href={`/viral/${r.id}`} className="hover:text-brand">{r.company_name}</Link>
                  {r.brand_name && <span className="ml-1 text-xs font-normal text-ink-soft">{r.brand_name}</span>}
                  {r.is_provisional && <span className="chip chip-warn ml-2">사업자번호 없음</span>}
                </td>
                <td className="max-w-64 px-4 py-3 text-ink-soft">
                  <span className="line-clamp-1">{r.first_item_description ?? r.description ?? "-"}</span>
                  {r.item_count > 1 && <span className="chip chip-info mt-1">외 {r.item_count - 1}개 · 총 {r.item_count}줄</span>}
                </td>
                <td className="px-4 py-3">{r.partner_name}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {won(r.sale_amount)}
                  {excluded.get(r.id) ? <div className="text-xs text-[var(--warn-ink)]" title="인센티브에서 빼는 금액">제외 {won(excluded.get(r.id)!)}</div> : null}
                </td>
                <td className={`px-4 py-3 text-right tabular-nums ${r.margin_amount < 0 ? "text-danger" : ""}`}>{won(r.margin_amount)}</td>
                <td className="px-4 py-3">{r.payment_received ? <span className="chip chip-ok">확인</span> : <span className="chip chip-warn">전</span>}</td>
                <td className="px-4 py-3"><span className={`chip ${INVOICE[r.invoice_status].cls}`}>{INVOICE[r.invoice_status].label}</span></td>
                <td className="px-4 py-3">{r.partner_paid ? <span className="chip chip-ok">완료</span> : <span className="chip chip-warn">미결제</span>}</td>
                <td className="px-4 py-3">
                  {r.staff_name ?? "-"}
                  {r.derived_staff_name && <span className="chip chip-info ml-1" title="파생 실적자">파생 {r.derived_staff_name}</span>}
                </td>
              </tr>
            ))}
            {!rows.length && !error && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-ink-soft">해당하는 바이럴 건이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
