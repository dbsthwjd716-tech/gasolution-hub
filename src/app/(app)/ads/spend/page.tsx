import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { fetchGroupSpend, fetchMetaSpend, fetchNaverSplit } from "@/lib/ads-legacy";

const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// 기간별 매체 광고비: 네이버 비즈머니 소진(검색광고+GFA) + 거래처 그룹별(검색광고·GFA·메타) + 메타 계정별
//   대표·팀장: 전체 또는 담당자 한 명 골라 보기 / 직원: 본인 담당만
export default async function Spend(props: PageProps<"/ads/spend">) {
  const sp = await props.searchParams;
  const { me } = await getMe();
  if (!me) return null;
  const manager = me.role !== "staff";
  const today = todayKST();
  let from = isDate(sp.from) ? sp.from : `${today.slice(0, 8)}01`;
  let to = isDate(sp.to) ? sp.to : today;
  if (to < from) [from, to] = [to, from];
  const [g, m, nv] = await Promise.all([fetchGroupSpend(from, to), fetchMetaSpend(from, to), fetchNaverSplit()]);
  if (!g.data || !m.data) return <p className="glass p-5 text-sm text-danger">{g.error ?? m.error}</p>;

  const names = [...new Set([...g.data.rows.map((r) => r.employee_name), ...m.data.rows.map((r) => r.employee_name), ...(nv.data?.rows ?? []).map((r) => r.manager ?? "")])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));
  const who = manager ? (typeof sp.m === "string" && names.includes(sp.m) ? sp.m : "") : me.name;
  const scope = (name: string | null) => (who ? name === who : true);
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

  // 네이버 비즈머니 소진 (이번 달, 아침 기록): 검색광고 + GFA 합산. 검색광고 기록이 없는 광고주 = GFA 전용(성과형)
  const naver = (nv.data?.rows ?? []).filter((r) => scope(r.manager));
  const nTotal = naver.reduce((t, r) => t + Number(r.month_cost), 0);
  const nGfaOnly = naver.filter((r) => r.gfa_only).reduce((t, r) => t + Number(r.month_cost), 0);
  const gfaStopped = nv.data?.gfa_collected_through && nv.data.gfa_collected_through < from ? nv.data.gfa_collected_through : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">광고비 실적</h1>
          <p className="text-sm text-ink-soft">{from} ~ {to} · {who ? `${who} 담당` : "전체 담당자"} · 검색광고는 VAT 별도, GFA·메타는 매체 청구 금액</p>
        </div>
        <form action="/ads/spend" className="flex flex-wrap items-center gap-2">
          {manager && (
            <select name="m" defaultValue={who} className="field !w-auto" aria-label="담당자">
              <option value="">전체 담당자</option>
              {names.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          <input type="date" name="from" defaultValue={from} className="field !w-auto" aria-label="시작일" />
          <span className="text-ink-soft">~</span>
          <input type="date" name="to" defaultValue={to} className="field !w-auto" aria-label="끝나는 날" />
          <button className="btn btn-ghost">보기</button>
        </form>
      </header>

      <section className="glass p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold">네이버 비즈머니 소진 · 이번 달 (검색광고 + GFA)</h2>
          <p className="text-xs text-ink-soft">{nv.data?.snapshot_date ? `${md(nv.data.snapshot_date)} 아침 기록 · VAT 별도 · 선택한 기간과 관계없이 이번 달 1일부터` : nv.error}</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            ["비즈머니 소진 합계", nTotal, `${naver.length}곳 · 검색광고와 GFA가 합쳐진 실제 차감액`],
            ["그중 GFA 전용(성과형) 계정", nGfaOnly, `${naver.filter((r) => r.gfa_only).length}곳 · 검색광고 기록이 없는 계정`],
            ["통합·검색광고 계정", nTotal - nGfaOnly, "검색광고 + 통합 계정의 GFA가 섞여 있음"],
          ].map(([k, v, sub]) => (
            <div key={k as string} className="rounded-xl bg-[#f6f8fc] p-3">
              <p className="text-xs text-ink-soft">{k as string}</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{won(v as number)}원</p>
              <p className="mt-0.5 text-[11.5px] text-ink-soft">{sub as string}</p>
            </div>
          ))}
        </div>
        <div className="-mx-4 mt-3 max-h-[420px] overflow-auto">
          <table className="w-full min-w-[720px] text-sm tabular-nums">
            <thead className="sticky top-0 bg-[#f8fafd]">
              <tr className="border-y border-[#edf1f7] text-left text-xs text-ink-soft">
                <th className="px-4 py-2 font-medium">광고주</th>{(manager && !who) && <th className="px-3 font-medium">담당</th>}<th className="px-3 font-medium">그룹</th>
                <th className="px-3 font-medium">구분</th><th className="px-4 text-right font-medium">비즈머니 소진</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf1f7]">
              {naver.map((r) => (
                <tr key={r.customer_id}>
                  <td className="px-4 py-2 font-medium">{r.advertiser_name ?? r.customer_id}</td>
                  {(manager && !who) && <td className="px-3 text-xs">{r.manager}</td>}
                  <td className="px-3 text-xs text-ink-soft">{r.client_group ?? "-"}</td>
                  <td className="px-3">{r.gfa_only ? <span className="chip chip-info">GFA 전용</span> : <span className="chip chip-muted">검색광고 · 통합</span>}</td>
                  <td className="px-4 text-right font-semibold">{won(Number(r.month_cost))}원</td>
                </tr>
              ))}
              {!naver.length && <tr><td colSpan={5} className="py-6 text-center text-ink-soft">이번 달 비즈머니 소진 기록이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          통합 계정은 검색광고와 GFA가 같은 비즈머니에서 빠져나가 이 기록만으로는 둘을 나눌 수 없습니다.
          {gfaStopped ? ` GFA 캠페인별 수집이 ${md(gfaStopped)} 이후 멈춰 있어, 아래 표의 GFA 칸은 수집기를 다시 연결하면 채워집니다.` : ""}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        {[["검색광고", all.sa], [gfaStopped ? "GFA (수집 중단)" : "GFA", all.gfa], ["메타", all.meta], ["합계", all.sa + all.gfa + all.meta]].map(([k, v]) => (
          <div key={k as string} className="glass p-4">
            <p className="text-xs text-ink-soft">{k as string}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{won(v as number)}원</p>
          </div>
        ))}
      </section>

      <section className="glass overflow-x-auto p-4">
        <h2 className="mb-1 text-sm font-bold">거래처 그룹별</h2>
        <p className="mb-2 text-xs text-ink-soft">선택한 기간 · 예전 대시보드 “계정 관리”에서 그룹에 묶인 광고주만 집계됩니다. 그룹 정리는 다음 단계에서 통합 시스템 거래처로 옮깁니다.</p>
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
