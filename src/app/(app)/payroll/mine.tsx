import type { SupabaseClient } from "@supabase/supabase-js";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
type Line = { key: string; label: string; amount: number; note?: string };
type Snapshot = { spend?: number; lines?: Line[] } | null;

// 직원: 마감(금액 확정)된 달의 본인 급여만 (데이터베이스 규칙으로도 본인 것만 읽힘)
export async function MyPayroll({ supabase, name }: { supabase: SupabaseClient; name: string }) {
  const { data } = await supabase.from("payroll_entries").select("month,total,snapshot").order("month", { ascending: false }).limit(24);
  const rows = (data ?? []) as { month: string; total: number | null; snapshot: Snapshot }[];
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">내 급여 · 인센티브</h1>
        <p className="text-sm text-ink-soft">{name}님 본인 급여만 보입니다. 대표·팀장이 마감(금액 확정)한 달부터 표시됩니다. 금액은 세전입니다.</p>
      </header>
      {!rows.length && <p className="glass p-6 text-sm text-ink-soft">아직 마감된 급여가 없습니다. 이번 달 급여가 확정되면 여기에 나옵니다.</p>}
      {rows.map((r, i) => {
        const [y, m] = r.month.split("-").map(Number);
        const lines = r.snapshot?.lines ?? [];
        return (
          <details key={r.month} open={i === 0} className="glass group p-5">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
              <span className="font-bold">{y}년 {m}월 실적분</span>
              <span className="flex items-center gap-3">
                {r.snapshot?.spend != null && <span className="text-xs text-ink-soft">마감 소진액 {won(r.snapshot.spend)}원</span>}
                <span className="text-lg font-bold tabular-nums text-brand">{won(Number(r.total ?? 0))}원</span>
                <span className="text-xs text-ink-soft group-open:rotate-180">▾</span>
              </span>
            </summary>
            <table className="mt-3 w-full text-sm tabular-nums">
              <tbody className="divide-y divide-[#edf1f7]">
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td className="py-2">{l.label}{l.note && <span className="block text-[11.5px] text-ink-soft">{l.note}</span>}</td>
                    <td className="py-2 text-right font-semibold">{won(l.amount)}원</td>
                  </tr>
                ))}
                <tr className="font-bold"><td className="py-2">지급 예정 합계</td><td className="py-2 text-right">{won(Number(r.total ?? 0))}원</td></tr>
              </tbody>
            </table>
          </details>
        );
      })}
    </div>
  );
}
