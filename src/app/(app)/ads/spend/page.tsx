import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { fetchGroupSpend, fetchMetaSpend } from "@/lib/ads-legacy";

const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// 기간별 매체 광고비: 거래처 그룹별(검색광고·GFA·메타) + 메타 계정별
export default async function Spend(props: PageProps<"/ads/spend">) {
  const sp = await props.searchParams;
  const { me } = await getMe();
  if (!me) return null;
  const manager = me.role !== "staff";
  const today = todayKST();
  let from = isDate(sp.from) ? sp.from : `${today.slice(0, 8)}01`;
  let to = isDate(sp.to) ? sp.to : today;
  if (to < from) [from, to] = [to, from];
  const [g, m] = await Promise.all([fetchGroupSpend(from, to), fetchMetaSpend(from, to)]);
  if (!g.data || !m.data) return <p className="glass p-5 text-sm text-danger">{g.error ?? m.error}</p>;

  const scope = (name: string) => manager || name === me.name;
  const groups = g.data.rows.filter((r) => scope(r.employee_name));
  const byEmp = new Map<string, typeof groups>();
  for (const r of groups) byEmp.set(r.employee_name, [...(byEmp.get(r.employee_name) ?? []), r]);
  const total = (rs: typeof groups) =>
    rs.reduce((t, r) => ({ sa: t.sa + Number(r.searchad_spend), gfa: t.gfa + Number(r.gfa_spend), meta: t.meta + Number(r.meta_spend) }), { sa: 0, gfa: 0, meta: 0 });
  const all = total(groups);

  const meta = m.data.rows.filter((r) => scope(r.employee_name));
  const metaAcc = new Map<string, { name: string; adv: string | null; emp: string; spend: number; days: number }>();
  for (const r of meta) {
    const k = `${r.external_account_id}|${r.employee_name}`;
    const x = metaAcc.get(k) ?? { name: r.account_name, adv: r.advertiser_name, emp: r.employee_name, spend: 0, days: 0 };
    x.spend += Number(r.spend);
    x.days += Number(r.spend) > 0 ? 1 : 0;
    metaAcc.set(k, x);
  }
  const metaList = [...metaAcc.values()].sort((a, b) => b.spend - a.spend);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">광고비 실적</h1>
          <p className="text-sm text-ink-soft">{from} ~ {to} · {manager ? "전체 담당자" : "내 담당"} · 검색광고는 VAT 별도, GFA·메타는 매체 청구 금액</p>
        </div>
        <form action="/ads/spend" className="flex flex-wrap items-center gap-2">
          <input type="date" name="from" defaultValue={from} className="field !w-auto" aria-label="시작일" />
          <span className="text-ink-soft">~</span>
          <input type="date" name="to" defaultValue={to} className="field !w-auto" aria-label="끝나는 날" />
          <button className="btn btn-ghost">보기</button>
        </form>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        {[["검색광고", all.sa], ["GFA", all.gfa], ["메타", all.meta], ["합계", all.sa + all.gfa + all.meta]].map(([k, v]) => (
          <div key={k as string} className="glass p-4">
            <p className="text-xs text-ink-soft">{k as string}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{won(v as number)}원</p>
          </div>
        ))}
      </section>

      <section className="glass overflow-x-auto p-4">
        <h2 className="mb-1 text-sm font-bold">거래처 그룹별</h2>
        <p className="mb-2 text-xs text-ink-soft">예전 대시보드 “계정 관리”에서 그룹에 묶인 광고주만 집계됩니다. 그룹 정리는 다음 단계에서 통합 시스템 거래처로 옮깁니다.</p>
        <table className="w-full min-w-[640px] text-sm tabular-nums">
          <thead className="text-left text-xs text-ink-soft">
            <tr><th className="py-1">담당자 / 그룹</th><th className="text-right">검색광고</th><th className="text-right">GFA</th><th className="text-right">메타</th><th className="text-right">합계</th></tr>
          </thead>
          <tbody>
            {[...byEmp.entries()].map(([emp, rs]) => {
              const t = total(rs);
              return [
                <tr key={emp} className="border-t border-[var(--glass-border)] bg-white/50 font-bold">
                  <td className="py-2">{emp}</td><td className="text-right">{won(t.sa)}</td><td className="text-right">{won(t.gfa)}</td><td className="text-right">{won(t.meta)}</td><td className="text-right">{won(t.sa + t.gfa + t.meta)}</td>
                </tr>,
                ...rs.map((r) => (
                  <tr key={`${emp}|${r.client_group_name}`}>
                    <td className="py-1 pl-4 text-ink-soft">{r.client_group_name}</td>
                    <td className="text-right">{won(Number(r.searchad_spend))}</td><td className="text-right">{won(Number(r.gfa_spend))}</td><td className="text-right">{won(Number(r.meta_spend))}</td>
                    <td className="text-right">{won(Number(r.searchad_spend) + Number(r.gfa_spend) + Number(r.meta_spend))}</td>
                  </tr>
                )),
              ];
            })}
            {!groups.length && <tr><td colSpan={5} className="py-6 text-center text-ink-soft">이 기간 집계가 없습니다.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="glass overflow-x-auto p-4">
        <h2 className="mb-2 text-sm font-bold">메타 계정별</h2>
        <table className="w-full min-w-[560px] text-sm tabular-nums">
          <thead className="text-left text-xs text-ink-soft">
            <tr><th className="py-1">계정</th><th>광고주</th><th>담당</th><th className="text-right">집행일</th><th className="text-right">광고비</th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-border)]">
            {metaList.map((x) => (
              <tr key={`${x.name}|${x.emp}`}>
                <td className="py-2 font-semibold">{x.name}</td><td className="text-xs">{x.adv ?? "-"}</td><td className="text-xs">{x.emp}</td>
                <td className="text-right">{x.days}일</td><td className="text-right">{won(x.spend)}원</td>
              </tr>
            ))}
            {!metaList.length && <tr><td colSpan={5} className="py-6 text-center text-ink-soft">이 기간 메타 광고비가 없습니다.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
