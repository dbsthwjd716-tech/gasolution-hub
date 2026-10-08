import Link from "next/link";
import { formatBizNo } from "@/lib/bizno";
import { markupText } from "@/lib/billing-calc";
import { createClient } from "@/lib/supabase/server";

type Row = {
  id: string;
  company_name: string;
  business_number: string | null;
  is_provisional: boolean;
  status: "lead" | "active" | "ended";
  kinds: string[];
  owner: { name: string } | null;
  brands: { id: string; name: string; media_accounts: { id: string }[] }[];
  fee_markup_type: "rate" | "fixed" | "none";
  fee_markup_rate: number;
  fee_markup_fixed: number;
};

const STATUS: Record<Row["status"], { label: string; cls: string }> = {
  lead: { label: "계약 전", cls: "chip-muted" },
  active: { label: "운영 중", cls: "chip-ok" },
  ended: { label: "종료", cls: "chip-muted" },
};

export default async function ClientsPage(props: PageProps<"/clients">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const filter = typeof sp.f === "string" ? sp.f : "all";

  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select(
      "id,company_name,business_number,is_provisional,status,kinds,fee_markup_type,fee_markup_rate,fee_markup_fixed,owner:staff!clients_owner_staff_id_fkey(name),brands(id,name,media_accounts(id))",
    )
    .order("company_name");
  if (filter === "provisional") query = query.eq("is_provisional", true);
  if (filter === "viral") query = query.contains("kinds", ["viral"]);
  if (filter === "active") query = query.eq("status", "active");

  const { data, error } = await query.returns<Row[]>();

  // 상호·브랜드·사업자번호 어디에 걸려도 찾도록 화면에서 거름
  const needle = q.replace(/[\s-]/g, "").toLowerCase();
  const rows = (data ?? []).filter((r) => {
    if (!needle) return true;
    const hay = [r.company_name, r.business_number ?? "", ...r.brands.map((b) => b.name)]
      .join(" ")
      .replace(/[\s-]/g, "")
      .toLowerCase();
    return hay.includes(needle);
  });
  const provisionalCount = (data ?? []).filter((r) => r.is_provisional).length;

  const tabs = [
    { f: "all", label: "전체" },
    { f: "active", label: "운영 중" },
    { f: "provisional", label: `사업자번호 없음 ${provisionalCount}` },
    { f: "viral", label: "바이럴" },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">거래처</h1>
          <p className="text-sm text-ink-soft">세금계산서를 받는 사업자 기준입니다. 한 거래처 밑에 브랜드와 매체 계정이 붙습니다.</p>
        </div>
        <Link href="/clients/new" className="btn">거래처 등록</Link>
      </header>

      <div className="glass flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <Link
              key={t.f}
              href={{ pathname: "/clients", query: { ...(q ? { q } : {}), f: t.f } }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${filter === t.f ? "bg-brand text-white" : "hover:bg-brand-soft"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <form className="flex gap-2">
          <input type="hidden" name="f" value={filter} />
          <input name="q" defaultValue={q} placeholder="상호·브랜드·사업자번호" className="field sm:w-64" aria-label="검색" />
          <button className="btn btn-ghost">검색</button>
        </form>
      </div>

      {error && <p className="glass p-4 text-sm text-danger">목록을 불러오지 못했습니다: {error.message}</p>}

      <div className="glass overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr className="border-b border-[var(--glass-border)]">
              <th className="px-4 py-3">상호</th>
              <th className="px-4 py-3">사업자번호</th>
              <th className="px-4 py-3">브랜드</th>
              <th className="px-4 py-3 text-right">매체 계정</th>
              <th className="px-4 py-3">수수료</th>
              <th className="px-4 py-3">담당</th>
              <th className="px-4 py-3">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--glass-border)] last:border-0 hover:bg-white/60">
                <td className="px-4 py-3 font-semibold">
                  <Link href={`/clients/${r.id}`} className="hover:text-brand">{r.company_name}</Link>
                  {r.kinds.includes("viral") && <span className="chip chip-info ml-2">바이럴</span>}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.is_provisional ? <span className="chip chip-warn">없음 (임시)</span> : formatBizNo(r.business_number)}
                </td>
                <td className="px-4 py-3 text-ink-soft">{r.brands.map((b) => b.name).join(", ") || "-"}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.brands.reduce((n, b) => n + b.media_accounts.length, 0)}
                </td>
                <td className="px-4 py-3 tabular-nums">{r.fee_markup_type === "none" ? <span className="text-ink-soft">-</span> : markupText(r.fee_markup_type, r.fee_markup_rate, r.fee_markup_fixed)}</td>
                <td className="px-4 py-3">{r.owner?.name ?? "-"}</td>
                <td className="px-4 py-3"><span className={`chip ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
              </tr>
            ))}
            {!rows.length && !error && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-soft">
                  {q ? `'${q}'에 맞는 거래처가 없습니다.` : "아직 등록된 거래처가 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
