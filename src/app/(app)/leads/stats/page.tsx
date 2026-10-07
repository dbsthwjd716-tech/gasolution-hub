import Link from "next/link";
import { kstDate, LEAD_STATUSES } from "@/lib/leads";
import { loadLeads, monthBounds, today, type LeadRow } from "@/lib/leads-data";
import { getMe } from "@/lib/supabase/server";

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const CONSULT = ["상담중", "제안/견적", "검토중", "계약완료"];

function shiftMonth(ym: string, d: number) {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

function Breakdown({ title, rows, total }: { title: string; rows: { key: string; n: number; consulted: number; won: number }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <section className="glass p-5">
      <h2 className="mb-3 font-bold">{title}</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-ink-soft">
          <tr><th className="py-1">구분</th><th className="py-1">문의</th><th className="py-1 text-right">상담 이상</th><th className="py-1 text-right">계약</th><th className="py-1 text-right">계약률</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-[var(--glass-border)]">
              <td className="py-1.5 pr-2">{r.key}</td>
              <td className="w-2/5 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 rounded-full bg-brand" style={{ width: `${(r.n / max) * 100}%`, minWidth: 4 }} />
                  <span className="tabular-nums text-xs">{r.n}{total ? ` (${Math.round((r.n / total) * 100)}%)` : ""}</span>
                </div>
              </td>
              <td className="py-1.5 text-right tabular-nums">{r.consulted}</td>
              <td className="py-1.5 text-right tabular-nums">{r.won}</td>
              <td className="py-1.5 text-right tabular-nums">{r.n ? `${Math.round((r.won / r.n) * 1000) / 10}%` : "-"}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="py-4 text-center text-ink-soft">자료가 없습니다.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function group(rows: LeadRow[], key: (l: LeadRow) => string[]) {
  const m = new Map<string, { key: string; n: number; consulted: number; won: number }>();
  for (const l of rows) {
    for (const k of key(l)) {
      const g = m.get(k) ?? { key: k, n: 0, consulted: 0, won: 0 };
      g.n++;
      if (CONSULT.includes(l.status)) g.consulted++;
      if (l.status === "계약완료") g.won++;
      m.set(k, g);
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

export default async function LeadStats(props: PageProps<"/leads/stats">) {
  const sp = await props.searchParams;
  const t = today();
  const cur = monthBounds(t.slice(0, 7));
  const from = isDate(sp.from) ? sp.from : cur.from;
  const to = isDate(sp.to) ? sp.to : cur.to;
  const { supabase } = await getMe();
  const trendFrom = monthBounds(shiftMonth(t.slice(0, 7), -5)).from;
  const [{ rows: all, error }, { rows: trendRows }] = await Promise.all([loadLeads(supabase, from, to), loadLeads(supabase, trendFrom, cur.to)]);
  const rows = all.filter((l) => l.status !== "스팸");
  const spam = all.length - rows.length;

  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(t.slice(0, 7), i - 5));
  const trend = months.map((ym) => {
    const r = trendRows.filter((l) => l.status !== "스팸" && kstDate(l.inquiry_at).startsWith(ym));
    return { ym, n: r.length, won: r.filter((l) => l.status === "계약완료").length };
  });
  const tmax = Math.max(1, ...trend.map((x) => x.n));
  const byStatus = LEAD_STATUSES.map((s) => ({ s, n: all.filter((l) => l.status === s).length }));

  return (
    <div className="space-y-4">
      <Link href="/leads" className="text-sm text-ink-soft hover:text-brand">← 인입 문의</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">유입 · 영업 통계</h1>
          <p className="text-sm text-ink-soft">스팸은 빼고 셉니다 (이 기간 스팸 {spam}건). 계약률 = 계약완료 ÷ 문의.</p>
        </div>
        <form className="flex flex-wrap items-center gap-2 text-sm" action="/leads/stats">
          <input type="date" name="from" defaultValue={from} className="field w-40" aria-label="시작일" />
          <span>~</span>
          <input type="date" name="to" defaultValue={to} className="field w-40" aria-label="종료일" />
          <button className="btn">조회</button>
        </form>
      </header>
      {error && <p className="glass p-4 text-sm text-danger">자료를 불러오지 못했습니다: {error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "유효 문의", value: `${rows.length}건` },
          { label: "상담 이상", value: `${rows.filter((l) => CONSULT.includes(l.status)).length}건` },
          { label: "계약완료", value: `${rows.filter((l) => l.status === "계약완료").length}건` },
          { label: "평균 월 예산 (적힌 문의)", value: (() => { const b = rows.map((l) => l.monthly_budget).filter((x): x is number => !!x); return b.length ? `${Math.round(b.reduce((a, c) => a + c, 0) / b.length).toLocaleString("ko-KR")}원` : "-"; })() },
        ].map((k) => (
          <div key={k.label} className="glass p-4"><p className="text-xs text-ink-soft">{k.label}</p><p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p></div>
        ))}
      </div>

      <section className="glass p-5">
        <h2 className="mb-3 font-bold">최근 6개월 문의 · 계약</h2>
        <div className="flex h-40 items-end gap-3">
          {trend.map((x) => (
            <div key={x.ym} className="flex flex-1 flex-col items-center gap-1 text-xs">
              <span className="tabular-nums">{x.n}건 · 계약 {x.won}</span>
              <div className="relative w-full max-w-16 rounded-t bg-brand-soft" style={{ height: `${(x.n / tmax) * 100}%`, minHeight: 4 }}>
                <div className="absolute bottom-0 w-full rounded-t bg-brand" style={{ height: x.n ? `${(x.won / x.n) * 100}%` : 0 }} />
              </div>
              <span className="text-ink-soft">{Number(x.ym.slice(5))}월</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="유입경로별" rows={group(rows, (l) => [l.source ?? "미지정"])} total={rows.length} />
        <Breakdown title="담당별" rows={group(rows, (l) => [l.staff_name ?? "미배정"])} total={rows.length} />
        <Breakdown title="광고 매체별 (여러 매체는 각각 셈)" rows={group(rows, (l) => (l.media.length ? l.media : ["미지정"]))} total={rows.length} />
        <section className="glass p-5">
          <h2 className="mb-3 font-bold">진행 상태별 (스팸 포함)</h2>
          <ul className="space-y-1 text-sm">
            {byStatus.map((x) => (
              <li key={x.s} className="flex justify-between border-t border-[var(--glass-border)] py-1 first:border-0">
                <Link href={{ pathname: "/leads", query: { from, to, status: x.s } }} className="hover:text-brand">{x.s}</Link>
                <span className="tabular-nums">{x.n}건</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
