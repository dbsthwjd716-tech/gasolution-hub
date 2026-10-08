import type { ReactNode } from "react";
import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { fetchPerfSpend } from "@/lib/ads-legacy";
import { setHandover } from "../actions";

const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const HANDOVER_OWNER = "서진원"; // 진원 인계건 (급여와 같은 기준)

type Row = { name: string; naver: number; meta: number; viral: number; handover: number };

// 광고비 실적: 전 매체(네이버 · 메타 · 바이럴) 한 화면, 모두 VAT 별도
//   대표·팀장: 전체 또는 담당자 한 명 / 직원: 본인만
//   서진원 인계건: 지금 담당자 실적에 들어가 있고, 서진원에게는 따로 보기만 (총 소진액에 넣지 않음)
//   서진원만 예외: 총 소진액 = 네이버 + 메타 (바이럴은 따로), total 소진액 = 네이버 + 메타 + 인계건
export default async function Spend(props: PageProps<"/ads/spend">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!me) return null;
  const manager = me.role !== "staff";
  const today = todayKST();
  let from = isDate(sp.from) ? sp.from : `${today.slice(0, 8)}01`;
  let to = isDate(sp.to) ? sp.to : today;
  if (to < from) [from, to] = [to, from];

  const [perf, { data: viral }, { data: flagged }] = await Promise.all([
    fetchPerfSpend(from, to),
    supabase.from("viral_orders_list").select("staff_name,company_name,sale_amount,paid_date").gte("paid_date", from).lte("paid_date", to).limit(5000),
    supabase.from("handover_accounts").select("customer_id"),
  ]);
  if (!perf.data) return <p className="glass p-5 text-sm text-danger">{perf.error}</p>;
  const flags = new Set((flagged ?? []).map((f) => String(f.customer_id)));
  // 인계건 금액: 통합 시스템에서 지정한 계정(지금 담당이 서진원이 아닐 때) 소진 전체 + 예전 대시보드 그룹 지정분
  const d = {
    ...perf.data,
    naver: perf.data.naver.map((r) => ({
      ...r,
      flagged: flags.has(String(r.customer_id)),
      handover_cost: flags.has(String(r.customer_id)) && r.manager !== HANDOVER_OWNER ? Number(r.cost) : Number(r.handover_cost ?? 0),
    })),
  };

  const names = [...new Set([...d.naver.map((r) => r.manager), ...d.meta.map((r) => r.manager), ...(viral ?? []).map((r) => r.staff_name ?? "")])]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));
  const who = manager ? (typeof sp.m === "string" && names.includes(sp.m) ? sp.m : "") : me.name;
  const mine = (n: string | null) => !who || n === who;

  // 담당자별 합계
  const by = new Map<string, Row>();
  const row = (n: string) => by.get(n) ?? (by.set(n, { name: n, naver: 0, meta: 0, viral: 0, handover: 0 }), by.get(n)!);
  for (const r of d.naver) {
    row(r.manager).naver += Number(r.cost);
    if (r.handover_cost) row(HANDOVER_OWNER).handover += Number(r.handover_cost);
  }
  for (const r of d.meta) row(r.manager).meta += Number(r.spend) / 1.1;
  for (const r of viral ?? []) if (r.staff_name) row(r.staff_name).viral += Number(r.sale_amount);
  const rowTotal = (r: Row) => (r.name === HANDOVER_OWNER ? r.naver + r.meta : r.naver + r.meta + r.viral);
  const rows = [...by.values()].filter((r) => mine(r.name) && r.naver + r.meta + r.viral + r.handover > 0).sort((a, b) => rowTotal(b) - rowTotal(a));
  const sum = rows.reduce((t, r) => ({ naver: t.naver + r.naver, meta: t.meta + r.meta, viral: t.viral + r.viral }), { naver: 0, meta: 0, viral: 0 });
  const total = rows.reduce((t, r) => t + rowTotal(r), 0);
  const jw = who === HANDOVER_OWNER; // 서진원 한 명만 볼 때
  const handoverRows = d.naver.filter((r) => r.handover_cost);
  const showHandover = mine(HANDOVER_OWNER) && (handoverRows.length > 0 || (manager && who === HANDOVER_OWNER));
  const handover = handoverRows.reduce((t, r) => t + Number(r.handover_cost), 0);
  const grand = total + handover; // 서진원 total 소진액 (인계건 포함)

  // 상세
  const naverList = d.naver.filter((r) => mine(r.manager));
  const metaList = d.meta.filter((r) => mine(r.manager));
  const viralBy = new Map<string, { client: string; staff: string; amount: number; count: number }>();
  for (const r of (viral ?? []).filter((x) => mine(x.staff_name))) {
    const k = `${r.company_name}|${r.staff_name}`;
    const x = viralBy.get(k) ?? { client: r.company_name ?? "-", staff: r.staff_name ?? "-", amount: 0, count: 0 };
    x.amount += Number(r.sale_amount);
    x.count++;
    viralBy.set(k, x);
  }
  const viralList = [...viralBy.values()].sort((a, b) => b.amount - a.amount);
  const share = (v: number) => (total > 0 ? `${Math.round((v / total) * 1000) / 10}%` : "-");

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">광고비 실적</h1>
          <p className="text-sm text-ink-soft">
            {from} ~ {to} · {who ? `${who} 담당` : "전체 담당자"} · 네이버 · 메타 · 바이럴 모두 VAT 별도
          </p>
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
          <button className="btn">조회</button>
        </form>
      </header>

      <section className={`grid gap-3 sm:grid-cols-2 ${jw ? "lg:grid-cols-3 2xl:grid-cols-6" : showHandover ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
        <Card label="총 소진액" value={total} sub={jw ? "네이버 + 메타" : who ? "네이버 + 메타 + 바이럴" : `네이버 + 메타 + 바이럴 (${HANDOVER_OWNER}은 바이럴 제외)`} strong />
        <Card label="네이버" value={sum.naver} sub={`유상실적 (검색광고 + GFA) · ${d.naver_through ? `${md(d.naver_through)}까지 반영` : "자료 없음"} · ${share(sum.naver)}`} />
        <Card label="메타" value={sum.meta} sub={`${d.meta_through ? `${md(d.meta_through)}까지` : "자료 없음"} · ${share(sum.meta)}`} />
        <Card label="바이럴" value={sum.viral} sub={`판매가 · 입금일 기준 · ${share(sum.viral)}`} />
        {showHandover && <Card label={jw ? "인계건" : `${HANDOVER_OWNER} 인계건`} value={handover} sub={jw ? "서진원 인계건" : "총 소진액에 넣지 않고 따로 보기"} handover />}
        {jw && <Card label="total 소진액" value={grand} sub="네이버 + 메타 + 인계건" strong />}
      </section>

      <section className="glass p-4">
        <h2 className="text-sm font-bold">담당자별</h2>
        <div className="-mx-4 mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm tabular-nums">
            <thead>
              <tr className="border-y border-[#edf1f7] bg-[#f8fafd] text-left text-xs text-ink-soft [&>th]:whitespace-nowrap">
                <th className="px-4 py-2.5 font-medium">담당자</th>
                <th className="px-3 text-right font-medium">네이버</th>
                <th className="px-3 text-right font-medium">메타</th>
                <th className="px-3 text-right font-medium">바이럴</th>
                <th className="px-3 text-right font-medium">총 소진액</th>
                {showHandover && <th className="px-4 text-right font-medium text-[#7a5200]">인계건 (별도)</th>}
                {jw && <th className="px-4 text-right font-medium">total 소진액</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf1f7]">
              {rows.map((r) => (
                <tr key={r.name} className="[&>td]:whitespace-nowrap">
                  <td className="px-4 py-2.5 font-semibold">{r.name}</td>
                  <td className="px-3 text-right">{won(r.naver)}</td>
                  <td className="px-3 text-right">{won(r.meta)}</td>
                  <td className="px-3 text-right">{won(r.viral)}</td>
                  <td className="px-3 text-right font-bold">{won(rowTotal(r))}</td>
                  {showHandover && <td className="bg-[#fffbf0] px-4 text-right text-[#7a5200]">{r.handover ? won(r.handover) : "-"}</td>}
                  {jw && <td className="px-4 text-right font-bold text-brand">{won(rowTotal(r) + r.handover)}</td>}
                </tr>
              ))}
              {rows.length > 1 && (
                <tr className="bg-[#f8fafd] font-bold [&>td]:whitespace-nowrap">
                  <td className="px-4 py-2.5">합계</td>
                  <td className="px-3 text-right">{won(sum.naver)}</td>
                  <td className="px-3 text-right">{won(sum.meta)}</td>
                  <td className="px-3 text-right">{won(sum.viral)}</td>
                  <td className="px-3 text-right">{won(total)}</td>
                  {showHandover && <td className="bg-[#fff6dd] px-4 text-right text-[#7a5200]">{won(handover)}</td>}
                </tr>
              )}
              {!rows.length && <tr><td colSpan={7} className="py-8 text-center text-ink-soft">이 기간 실적이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          네이버는 담당자가 올린 유상실적(검색광고와 GFA 포함, 광고주의 지금 담당자 기준)이라 올린 날짜까지만 반영됩니다. 메타는 담당 배정 기간 기준 광고비 ÷ 1.1.
          {showHandover && ` 인계건은 「인계건 지정」된 광고주의 소진으로, 지금 담당자의 네이버 실적에 이미 들어가 있습니다. ${HANDOVER_OWNER}은 총 소진액 = 네이버 + 메타(바이럴 제외), total 소진액 = 네이버 + 메타 + 인계건입니다.`}
        </p>
      </section>

      {showHandover && (
        <Detail title={`${HANDOVER_OWNER} 인계건`} sub={manager ? "총 소진액 미포함 · 아래 네이버 광고주별 표의 「인계건 지정」으로 추가" : "총 소진액 미포함 · 따로 보기"} count={handoverRows.length} tone="handover">
          <Table head={["광고주", "그룹", "지금 담당", "인계건 소진", ...(manager ? [""] : [])]} right={[3]}>
            {handoverRows.map((r) => (
              <tr key={r.customer_id}>
                <td className="px-4 py-2">{r.advertiser_name ?? r.customer_id}</td>
                <td className="px-3 text-xs text-ink-soft">{r.group ?? "-"}</td>
                <td className="px-3 text-xs">{r.manager}</td>
                <td className="px-4 text-right font-semibold">{won(Number(r.handover_cost))}원</td>
                {manager && <td className="pr-4 text-right">{r.flagged && <form action={setHandover.bind(null, String(r.customer_id), r.advertiser_name ?? "", false)}><button className="text-xs text-ink-soft underline hover:text-danger">해제</button></form>}</td>}
              </tr>
            ))}
          </Table>
        </Detail>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Detail title="네이버 광고주별" sub="유상실적 · 검색광고 + GFA" count={naverList.length}>
          <Table head={["광고주", ...(who ? [] : ["담당"]), "소진액", ...(manager ? ["인계건"] : [])]} right={[who ? 1 : 2]}>
            {naverList.map((r) => (
              <tr key={r.customer_id}>
                <td className="px-4 py-2">
                  {r.advertiser_name ?? r.customer_id}
                  {r.handover_cost ? <span className="chip ml-1.5 bg-[#fff6dd] !text-[10.5px] text-[#7a5200]">인계건</span> : null}
                  <span className="block text-[11px] text-ink-soft">{r.customer_id}{r.group ? ` · ${r.group}` : ""}</span>
                </td>
                {!who && <td className="px-3 text-xs">{r.manager}</td>}
                <td className="px-4 text-right font-semibold">{won(Number(r.cost))}원</td>
                {manager && (
                  <td className="pr-4 text-right">
                    {r.manager !== HANDOVER_OWNER && (
                      <form action={setHandover.bind(null, String(r.customer_id), r.advertiser_name ?? "", !r.flagged)}>
                        <button className={`whitespace-nowrap text-xs ${r.flagged ? "text-[#7a5200] underline" : "text-brand hover:underline"}`}>{r.flagged ? "해제" : "인계건 지정"}</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </Table>
        </Detail>
        <div className="space-y-4">
          <Detail title="메타 계정별" sub="VAT 별도 (÷1.1)" count={metaList.length}>
            <Table head={["계정", ...(who ? [] : ["담당"]), "집행일", "광고비"]} right={[who ? 1 : 2, who ? 2 : 3]}>
              {metaList.map((r) => (
                <tr key={`${r.account_name}|${r.manager}`}>
                  <td className="px-4 py-2">{r.account_name}<span className="block text-[11px] text-ink-soft">{r.advertiser_name ?? ""}</span></td>
                  {!who && <td className="px-3 text-xs">{r.manager}</td>}
                  <td className="px-3 text-right text-xs">{r.days}일</td>
                  <td className="px-4 text-right font-semibold">{won(Number(r.spend) / 1.1)}원</td>
                </tr>
              ))}
            </Table>
          </Detail>
          <Detail title="바이럴 거래처별" sub="판매가 · 입금일 기준" count={viralList.length}>
            <Table head={["거래처", ...(who ? [] : ["담당"]), "건수", "판매가"]} right={[who ? 1 : 2, who ? 2 : 3]}>
              {viralList.map((r) => (
                <tr key={`${r.client}|${r.staff}`}>
                  <td className="px-4 py-2">{r.client}</td>
                  {!who && <td className="px-3 text-xs">{r.staff}</td>}
                  <td className="px-3 text-right text-xs">{r.count}건</td>
                  <td className="px-4 text-right font-semibold">{won(r.amount)}원</td>
                </tr>
              ))}
            </Table>
          </Detail>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub, strong, handover }: { label: string; value: number; sub: string; strong?: boolean; handover?: boolean }) {
  return (
    <div className={`glass p-4 ${strong ? "!border-[#cddcff] !bg-[#f5f8ff]" : ""} ${handover ? "!border-dashed !border-[#f0d48a] !bg-[#fffbf0]" : ""}`}>
      <p className={`text-xs ${handover ? "font-semibold text-[#7a5200]" : "text-ink-soft"}`}>{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${strong ? "text-brand" : ""} ${handover ? "text-[#7a5200]" : ""}`}>{won(value)}원</p>
      <p className="mt-0.5 text-[11.5px] text-ink-soft">{sub}</p>
    </div>
  );
}

function Detail({ title, sub, count, tone, children }: { title: string; sub: string; count: number; tone?: "handover"; children: ReactNode }) {
  return (
    <section className={`glass p-4 ${tone === "handover" ? "!border-dashed !border-[#f0d48a]" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={`text-sm font-bold ${tone === "handover" ? "text-[#7a5200]" : ""}`}>{title}</h2>
        <p className="text-xs text-ink-soft">{sub} · {count}곳</p>
      </div>
      {count ? children : <p className="mt-3 text-sm text-ink-soft">이 기간 기록이 없습니다.</p>}
    </section>
  );
}

function Table({ head, right, children }: { head: string[]; right: number[]; children: ReactNode }) {
  return (
    <div className="-mx-4 mt-2 max-h-[460px] overflow-auto">
      <table className="w-full text-sm tabular-nums">
        <thead className="sticky top-0 bg-[#f8fafd]">
          <tr className="border-y border-[#edf1f7] text-left text-xs text-ink-soft">
            {head.map((h, i) => <th key={h} className={`py-2 font-medium ${i === 0 ? "px-4" : i === head.length - 1 ? "px-4" : "px-3"} ${right.includes(i) ? "text-right" : ""}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#edf1f7]">{children}</tbody>
      </table>
    </div>
  );
}
