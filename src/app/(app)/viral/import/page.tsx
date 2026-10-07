import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { formatBizNo } from "@/lib/bizno";
import type { ImportPlan, Problem } from "@/lib/viral-import";
import { loadSheetPlan } from "../data";
import { RunImport } from "./run-import";

const won = (n: number) => n.toLocaleString("ko-KR");

function ProblemTable({ title, items, tone }: { title: string; items: Problem[]; tone: "warn" | "danger" }) {
  if (!items.length) return null;
  return (
    <section className="glass p-5">
      <h2 className="font-bold">{title} <span className="text-ink-soft">{items.length}줄</span></h2>
      <div className="mt-3 max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {items.map((p, i) => (
              <tr key={i} className="border-b border-[var(--glass-border)] last:border-0">
                <td className="w-28 py-2 pr-3 text-ink-soft">{p.tab} {p.row}행</td>
                <td className={`py-2 ${tone === "danger" ? "text-danger" : ""}`}>{p.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function ImportPage(props: PageProps<"/viral/import">) {
  const sp = await props.searchParams;
  const { me } = await getMe();
  if (!me || (me.role !== "ceo" && me.role !== "lead"))
    return <p className="glass p-6 text-sm">대표·팀장만 시트를 옮길 수 있습니다.</p>;

  let plan: ImportPlan | null = null;
  let error = "";
  if (sp.preview === "1") {
    try {
      plan = await loadSheetPlan();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/viral" className="text-sm text-ink-soft hover:text-brand">← 바이럴 목록</Link>
      <header className="glass p-5">
        <h1 className="text-xl font-bold">구글 시트에서 옮기기</h1>
        <p className="mt-1 text-sm text-ink-soft">
          &lsquo;바이럴 견적 및 세금계산서 요청&rsquo; 시트의 제이솔·풀림·포에스·애드매니저 탭을 읽습니다. 시트는 바꾸지 않습니다.
          먼저 미리보기로 확인한 뒤 옮기세요. 여러 번 옮겨도 같은 줄은 한 건으로 유지됩니다.
        </p>
        <Link href={{ pathname: "/viral/import", query: { preview: "1" } }} className="btn mt-4">{plan ? "다시 읽기" : "시트 읽어서 미리보기"}</Link>
      </header>

      {error && <p className="glass p-4 text-sm text-danger">{error}</p>}

      {plan && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "시트 줄 수", value: `${plan.totals.rows}줄` },
              { label: "옮길 바이럴 건", value: `${plan.totals.orders}건` },
              { label: "판매가 합계", value: `${won(plan.totals.saleAmount)}원` },
              { label: "거래처", value: `${plan.clients.length}곳 (사업자번호 없음 ${plan.clients.filter((c) => !c.businessNumber).length})` },
            ].map((k) => (
              <div key={k.label} className="glass p-4">
                <p className="text-xs text-ink-soft">{k.label}</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p>
              </div>
            ))}
          </div>

          <ProblemTable title="옮기지 못하는 줄 (시트에서 고친 뒤 다시 읽어 주세요)" items={plan.skipped} tone="danger" />
          <ProblemTable title="옮기지만 확인이 필요한 줄" items={plan.warnings} tone="warn" />

          <section className="glass p-5">
            <h2 className="font-bold">만들거나 연결할 거래처</h2>
            <p className="text-xs text-ink-soft">이미 등록된 거래처는 사업자번호·이름으로 찾아서 연결하고, 비어 있는 칸만 시트 정보로 채웁니다.</p>
            <div className="mt-3 max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-soft">
                  <tr><th className="py-2">상호</th><th>사업자번호</th><th>대표자</th><th>메일</th><th className="text-right">건수</th></tr>
                </thead>
                <tbody>
                  {plan.clients.map((c) => (
                    <tr key={c.key} className="border-t border-[var(--glass-border)]">
                      <td className="py-2 font-semibold">
                        {c.companyName}
                        {c.otherNames.length > 0 && <span className="ml-1 text-xs font-normal text-ink-soft">({c.otherNames.join(", ")})</span>}
                      </td>
                      <td className="tabular-nums">{c.businessNumber ? formatBizNo(c.businessNumber) : <span className="chip chip-warn">없음</span>}</td>
                      <td>{c.representativeName ?? "-"}</td>
                      <td className="text-ink-soft">{c.billingEmails.join(", ") || "-"}</td>
                      <td className="text-right tabular-nums">{c.orderCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <RunImport />
        </>
      )}
    </div>
  );
}
