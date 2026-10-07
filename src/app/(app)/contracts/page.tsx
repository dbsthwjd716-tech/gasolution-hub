import Link from "next/link";
import { CONTRACT_STATUS, markupText, won } from "@/lib/billing-calc";
import { MEDIA_LABEL } from "@/lib/billing-data";
import { getMe } from "@/lib/supabase/server";


type Row = {
  id: string;
  contract_date: string;
  start_date: string | null;
  end_date: string | null;
  media: string[];
  markup_type: "rate" | "fixed" | "none";
  markup_rate: number;
  markup_fixed: number;
  min_fee: number;
  vat_mode: string;
  status: string;
  completion_type: string | null;
  client: { company_name: string } | null;
  brand: { name: string } | null;
  staff: { name: string } | null;
};

export default async function ContractsPage(props: PageProps<"/contracts">) {
  const sp = await props.searchParams;
  const tab = typeof sp.t === "string" ? sp.t : "open";
  const { supabase } = await getMe();
  let q = supabase
    .from("contracts")
    .select("id,contract_date,start_date,end_date,media,markup_type,markup_rate,markup_fixed,min_fee,vat_mode,status,completion_type,client:clients(company_name),brand:brands(name),staff:staff!contracts_staff_id_fkey(name)")
    .order("contract_date", { ascending: false })
    .limit(1000);
  if (tab === "open") q = q.in("status", ["draft", "signing"]);
  if (tab === "active") q = q.eq("status", "active");
  if (tab === "hold") q = q.in("status", ["on_hold", "rejected"]);
  const { data, error } = await q.returns<Row[]>();
  const rows = data ?? [];
  const tabs = [
    { t: "open", label: "진행 중" },
    { t: "active", label: "계약 완료" },
    { t: "hold", label: "보류·반려" },
    { t: "all", label: "전체" },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">계약</h1>
          <p className="text-sm text-ink-soft">계약 완료된 조건(요율·최소 대행비·VAT)이 정산서 작성 때 자동으로 들어갑니다.</p>
        </div>
        <Link href="/contracts/new" className="btn">계약 등록</Link>
      </header>
      <nav className="glass flex flex-wrap gap-1 p-3">
        {tabs.map((x) => (
          <Link key={x.t} href={{ pathname: "/contracts", query: { t: x.t } }} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === x.t ? "bg-brand text-white" : "hover:bg-brand-soft"}`}>
            {x.label}
          </Link>
        ))}
      </nav>
      {error && <p className="glass p-4 text-sm text-danger">목록을 불러오지 못했습니다: {error.message}</p>}
      <div className="glass overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr className="border-b border-[var(--glass-border)]">
              <th className="px-4 py-3">계약일</th>
              <th className="px-4 py-3">거래처</th>
              <th className="px-4 py-3">매체</th>
              <th className="px-4 py-3">마크업</th>
              <th className="px-4 py-3">최소 대행비</th>
              <th className="px-4 py-3">기간</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">담당</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--glass-border)] last:border-0 hover:bg-white/60">
                <td className="px-4 py-3 tabular-nums">{r.contract_date}</td>
                <td className="px-4 py-3 font-semibold">
                  <Link href={`/contracts/${r.id}`} className="hover:text-brand">{r.client?.company_name ?? "-"}</Link>
                  {r.brand && <span className="ml-1 text-xs font-normal text-ink-soft">{r.brand.name}</span>}
                </td>
                <td className="px-4 py-3">{r.media.map((m) => MEDIA_LABEL[m] ?? m).join(", ") || "-"}</td>
                <td className="px-4 py-3">{markupText(r.markup_type, r.markup_rate, r.markup_fixed)} <span className="text-xs text-ink-soft">VAT {r.vat_mode === "included" ? "포함" : "별도"}</span></td>
                <td className="px-4 py-3 tabular-nums">{Number(r.min_fee) ? won(r.min_fee) : "-"}</td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">{r.start_date ?? "?"} ~ {r.end_date ?? ""}</td>
                <td className="px-4 py-3">
                  <span className={`chip ${CONTRACT_STATUS[r.status]?.cls}`}>{CONTRACT_STATUS[r.status]?.label}</span>
                  {r.completion_type === "no_document" && <span className="ml-1 text-xs text-ink-soft">계약서 없음</span>}
                </td>
                <td className="px-4 py-3">{r.staff?.name ?? "-"}</td>
              </tr>
            ))}
            {!rows.length && !error && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-soft">해당하는 계약이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
