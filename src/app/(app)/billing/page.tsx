import Link from "next/link";
import { DOC_TYPE_LABEL, statusLabel, todayKST, won, type BillingStatus, type DocType } from "@/lib/billing-calc";
import { getMe } from "@/lib/supabase/server";

type Row = {
  id: string;
  doc_type: DocType;
  document_date: string;
  period_start: string | null;
  period_end: string | null;
  recipient_company_name: string;
  total_amount: number;
  status: BillingStatus;
  payment_received: boolean;
  staff_id: string | null;
  staff: { name: string } | null;
  billing_files: { count: number }[];
};

const STATUS_CLS: Record<BillingStatus, string> = {
  draft: "chip-muted",
  requested: "chip-info",
  lead_approved: "chip-info",
  approved: "chip-warn",
  issued: "chip-ok",
  rejected: "chip-warn",
  cancelled: "chip-muted",
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

export default async function BillingPage(props: PageProps<"/billing">) {
  const sp = await props.searchParams;
  const thisMonth = todayKST().slice(0, 7);
  const ym = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : thisMonth;
  const { supabase, me } = await getMe();
  const role = me?.role;
  const defaultTab = role === "staff" ? "all" : "todo";
  const tab = typeof sp.t === "string" ? sp.t : defaultTab;
  const mine = sp.mine === "1";

  let q = supabase
    .from("billing_documents")
    .select("id,doc_type,document_date,period_start,period_end,recipient_company_name,total_amount,status,payment_received,staff_id,staff:staff!billing_documents_staff_id_fkey(name),billing_files(count)")
    .order("document_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (tab === "all") {
    const r = monthRange(ym);
    q = q.gte("document_date", r.from).lt("document_date", r.to);
  }
  // 내 승인 차례: 팀장은 1차 승인·견적 확인, 대표는 최종 승인(1차 전 건 포함)
  if (tab === "todo") q = role === "ceo" ? q.in("status", ["requested", "lead_approved"]) : q.eq("status", "requested");
  if (tab === "issue") q = q.eq("doc_type", "settlement").eq("status", "approved");
  if (tab === "unpaid") q = q.eq("doc_type", "settlement").in("status", ["approved", "issued"]).eq("payment_received", false);
  if (tab === "rejected") q = q.eq("status", "rejected");
  if (mine && me) q = q.eq("staff_id", me.id);
  const { data, error } = await q.returns<Row[]>();
  const rows = data ?? [];

  const tabs = [
    ...(role !== "staff" ? [{ t: "todo", label: "내 승인 차례" }] : []),
    { t: "all", label: "월별 전체" },
    { t: "issue", label: "세금계산서 발행 대기" },
    { t: "unpaid", label: "입금 확인 전" },
    { t: "rejected", label: "반려" },
  ];
  const link = (o: Record<string, string | undefined>) => ({
    pathname: "/billing",
    query: Object.fromEntries(Object.entries({ m: ym, t: tab, mine: mine ? "1" : undefined, ...o }).filter(([, v]) => v)),
  });
  const settlementTotal = rows.filter((r) => r.doc_type === "settlement" && !["cancelled", "rejected", "draft"].includes(r.status)).reduce((s, r) => s + Number(r.total_amount), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">정산 · 견적</h1>
          <p className="text-sm text-ink-soft">광고비 정산(세금계산서 발행요청)과 견적서. 직원 요청 → 팀장 1차 승인 → 대표 최종 승인.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/billing/new?type=viral_estimate" className="btn btn-ghost">견적서 작성</Link>
          <Link href="/billing/new?type=settlement" className="btn">정산서 작성</Link>
        </div>
      </header>

      <div className="glass flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <nav className="flex flex-wrap gap-1">
          {tabs.map((x) => (
            <Link key={x.t} href={link({ t: x.t })} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === x.t ? "bg-brand text-white" : "hover:bg-brand-soft"}`}>{x.label}</Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {tab === "all" && (
            <>
              <Link href={link({ m: shiftMonth(ym, -1) })} className="btn btn-ghost px-3" aria-label="이전 달">‹</Link>
              <span className="min-w-20 text-center font-semibold">{ym.slice(0, 4)}년 {Number(ym.slice(5))}월 작성</span>
              <Link href={link({ m: shiftMonth(ym, 1) })} className="btn btn-ghost px-3" aria-label="다음 달">›</Link>
            </>
          )}
          <Link href={link({ mine: mine ? undefined : "1" })} className={`chip ${mine ? "chip-info" : "chip-muted"}`}>{mine ? "✓ 내 문서만" : "내 문서만"}</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="glass p-4"><p className="text-xs text-ink-soft">문서 수</p><p className="mt-1 text-lg font-bold">{rows.length}건</p></div>
        <div className="glass p-4"><p className="text-xs text-ink-soft">정산 요청금액 합계 (작성중·반려·취소 제외)</p><p className="mt-1 text-lg font-bold tabular-nums">{won(settlementTotal)}</p></div>
      </div>

      {error && <p className="glass p-4 text-sm text-danger">목록을 불러오지 못했습니다: {error.message}</p>}
      <div className="glass overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr className="border-b border-[var(--glass-border)]">
              <th className="px-4 py-3">작성일</th>
              <th className="px-4 py-3">문서</th>
              <th className="px-4 py-3">거래처</th>
              <th className="px-4 py-3">정산 기간</th>
              <th className="px-4 py-3 text-right">금액</th>
              <th className="px-4 py-3">진행</th>
              <th className="px-4 py-3">입금</th>
              <th className="px-4 py-3">담당</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--glass-border)] last:border-0 hover:bg-white/60">
                <td className="px-4 py-3 tabular-nums">{r.document_date}</td>
                <td className="px-4 py-3">{DOC_TYPE_LABEL[r.doc_type]}{r.doc_type === "settlement" && !r.billing_files?.[0]?.count && <span className="chip chip-warn ml-1">증빙 없음</span>}</td>
                <td className="px-4 py-3 font-semibold"><Link href={`/billing/${r.id}`} className="hover:text-brand">{r.recipient_company_name}</Link></td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">{r.period_start ? `${r.period_start.slice(5)} ~ ${r.period_end?.slice(5)}` : "-"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{won(r.total_amount)}</td>
                <td className="px-4 py-3"><span className={`chip ${STATUS_CLS[r.status]}`}>{statusLabel(r.doc_type, r.status)}</span></td>
                <td className="px-4 py-3">{r.doc_type !== "settlement" ? "-" : r.payment_received ? <span className="chip chip-ok">확인</span> : <span className="chip chip-muted">전</span>}</td>
                <td className="px-4 py-3">{r.staff?.name ?? "-"}</td>
              </tr>
            ))}
            {!rows.length && !error && <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-soft">해당하는 문서가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
