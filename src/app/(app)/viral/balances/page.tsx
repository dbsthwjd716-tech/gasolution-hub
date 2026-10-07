import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { CREDIT_ENTRY_LABEL } from "@/lib/viral-products";
import { currentMonthKST } from "../data";

const won = (n: number) => Number(n).toLocaleString("ko-KR");
type Credit = { id: string; client_id: string; order_id: string | null; kind: "refund" | "prepaid"; entry: string; amount: number; occurred_on: string; memo: string | null; clients: { company_name: string } | null };

function shiftMonth(ym: string, d: number) {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Bal = { open: number; plus: number; minus: number; close: number };
const empty = (): Bal => ({ open: 0, plus: 0, minus: 0, close: 0 });

export default async function ViralBalances(props: PageProps<"/viral/balances">) {
  const sp = await props.searchParams;
  const ym = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : currentMonthKST();
  const from = `${ym}-01`;
  const to = `${shiftMonth(ym, 1)}-01`;
  const { supabase } = await getMe();
  const { data, error } = await supabase
    .from("viral_credits")
    .select("id,client_id,order_id,kind,entry,amount,occurred_on,memo,clients(company_name)")
    .lt("occurred_on", to)
    .order("occurred_on")
    .returns<Credit[]>();

  // 업체별: 달 시작 잔액 → 이번 달 발생(+) · 사용(-) → 달 끝 잔액 (환불·미소진 따로)
  const byClient = new Map<string, { name: string; refund: Bal; prepaid: Bal; month: Credit[] }>();
  for (const c of data ?? []) {
    const g = byClient.get(c.client_id) ?? { name: c.clients?.company_name ?? "-", refund: empty(), prepaid: empty(), month: [] };
    const b = g[c.kind];
    const plus = c.entry === "refund_issued" || c.entry === "prepaid_received";
    const v = Number(c.amount);
    if (c.occurred_on < from) b.open += plus ? v : -v;
    else {
      if (plus) b.plus += v;
      else b.minus += v;
      g.month.push(c);
    }
    b.close = b.open + b.plus - b.minus;
    byClient.set(c.client_id, g);
  }
  const rows = [...byClient.entries()]
    .filter(([, g]) => g.refund.close || g.prepaid.close || g.month.length)
    .sort((a, b) => b[1].prepaid.close + b[1].refund.close - (a[1].prepaid.close + a[1].refund.close));
  const total = rows.reduce((t, [, g]) => ({ refund: t.refund + g.refund.close, prepaid: t.prepaid + g.prepaid.close }), { refund: 0, prepaid: 0 });

  const cell = (b: Bal) => (
    <>
      <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{won(b.open)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{b.plus ? `+${won(b.plus)}` : ""}</td>
      <td className="px-3 py-2 text-right tabular-nums">{b.minus ? `−${won(b.minus)}` : ""}</td>
      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${b.close ? "" : "text-ink-soft"}`}>{won(b.close)}</td>
    </>
  );

  return (
    <div className="space-y-4">
      <Link href="/viral" className="text-sm text-ink-soft hover:text-brand">← 바이럴 목록</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">업체별 환불 · 미소진 잔액</h1>
          <p className="text-sm text-ink-soft">
            환불 잔액 = 고객에게 돌려주거나 다음 바이럴에서 덜 받아야 할 금액. 미소진 잔액 = 판매가보다 더 받아 두고 아직 쓰지 않은 금액. 모두 VAT 별도.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={{ pathname: "/viral/balances", query: { m: shiftMonth(ym, -1) } }} className="btn btn-ghost px-3" aria-label="이전 달">‹</Link>
          <span className="min-w-20 text-center font-semibold">{ym.slice(0, 4)}년 {Number(ym.slice(5))}월</span>
          <Link href={{ pathname: "/viral/balances", query: { m: shiftMonth(ym, 1) } }} className="btn btn-ghost px-3" aria-label="다음 달">›</Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="glass p-4"><p className="text-xs text-ink-soft">{Number(ym.slice(5))}월 말 환불 잔액 합계</p><p className="mt-1 text-lg font-bold tabular-nums">{won(total.refund)}원</p></div>
        <div className="glass p-4"><p className="text-xs text-ink-soft">{Number(ym.slice(5))}월 말 미소진 잔액 합계</p><p className="mt-1 text-lg font-bold tabular-nums">{won(total.prepaid)}원</p></div>
      </div>
      {error && <p className="glass p-4 text-sm text-danger">불러오지 못했습니다: {error.message}</p>}

      <div className="glass overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-xs text-ink-soft">
            <tr className="border-b border-[var(--glass-border)]">
              <th rowSpan={2} className="px-3 py-2 text-left">업체</th>
              <th colSpan={4} className="border-l border-[var(--glass-border)] px-3 py-2">환불</th>
              <th colSpan={4} className="border-l border-[var(--glass-border)] px-3 py-2">미소진</th>
            </tr>
            <tr className="border-b border-[var(--glass-border)]">
              {["지난달 잔액", "발생", "환급·차감", "남은 잔액", "지난달 잔액", "발생", "사용", "남은 잔액"].map((h, i) => (
                <th key={i} className={`px-3 py-2 text-right ${i % 4 === 0 ? "border-l border-[var(--glass-border)]" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, g]) => (
              <tr key={id} className="border-b border-[var(--glass-border)] align-top last:border-0">
                <td className="px-3 py-2">
                  <Link href={`/clients/${id}`} className="font-semibold hover:text-brand">{g.name}</Link>
                  {g.month.length > 0 && (
                    <details className="mt-1 text-xs text-ink-soft">
                      <summary className="cursor-pointer">이번 달 기록 {g.month.length}개</summary>
                      <ul className="mt-1 space-y-0.5">
                        {g.month.map((c) => (
                          <li key={c.id}>
                            {c.occurred_on.slice(5)} {CREDIT_ENTRY_LABEL[c.entry]} {won(c.amount)}{c.memo ? ` · ${c.memo}` : ""}
                            {c.order_id && <Link href={`/viral/${c.order_id}`} className="ml-1 underline">건</Link>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                {cell(g.refund)}
                {cell(g.prepaid)}
              </tr>
            ))}
            {!rows.length && !error && <tr><td colSpan={9} className="px-4 py-10 text-center text-ink-soft">기록이 없습니다. 바이럴 건 상세 화면의 &lsquo;환불 · 미소진&rsquo;에서 기록합니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
