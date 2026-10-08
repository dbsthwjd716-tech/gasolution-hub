import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { changePct, daysInMonth, hiddenReason, netCost, netDaily, SORT_KEYS, sortBy, STATUS_LABEL, summarize, type BizRow, type SortDir, type SortKey, type Summary } from "@/lib/ads";
import { fetchBizmoney } from "@/lib/ads-legacy";

const won = (v: number) => Math.round(v).toLocaleString("ko-KR");
const kstTime = (ts: string | null | undefined) =>
  ts ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)) : "";

function Pct({ now, prev }: { now: number; prev: number }) {
  const p = changePct(now, prev);
  if (p == null) return null;
  return <span className={`ml-1 text-xs ${p >= 0 ? "text-[var(--ok-ink)]" : "text-danger"}`}>{p >= 0 ? "▲" : "▼"}{Math.abs(p)}%</span>;
}

function Cards({ s, prevLabel }: { s: Summary; prevLabel: string }) {
  const items: [string, React.ReactNode, string?][] = [
    ["광고주", `${s.count}곳`, `정상 ${s.normal} · 주의 ${s.warning} · 위험 ${s.danger}${s.failed ? ` · 실패 ${s.failed}` : ""}`],
    ["이번 달 소진 (VAT 별도)", <>{won(s.cost)}원<Pct now={s.cost} prev={s.prevCost} /></>, `${prevLabel} ${won(s.prevCost)}원`],
    ["일평균 (VAT 별도)", `${won(s.daily)}원`, undefined],
    ["월말 예상 (VAT 별도)", `${won(s.forecast)}원`, "일평균 × 이번 달 일수"],
    ["비즈머니 잔액 합계", `${won(s.bizmoney)}원`, undefined],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {items.map(([k, v, sub]) => (
        <div key={k} className="glass p-4">
          <p className="text-xs text-ink-soft">{k}</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{v}</p>
          {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
        </div>
      ))}
    </div>
  );
}

const SORT_LABEL: Record<SortKey, string> = { cost: "이번 달 소진", bizmoney: "현재 비즈머니", daily: "일평균 소진" };

// 네이버 광고주별 비즈머니·이번 달 소진 (매일 아침 확인한 기록)
export default async function Bizmoney(props: PageProps<"/ads">) {
  const sp = await props.searchParams;
  const { me } = await getMe();
  if (!me) return null;
  const manager = me.role !== "staff";
  const { data, error } = await fetchBizmoney();
  if (!data) return <p className="glass p-5 text-sm text-danger">{error}</p>;

  const who = manager ? (typeof sp.m === "string" ? sp.m : "") : me.name;
  const status = typeof sp.s === "string" ? sp.s : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const showAll = sp.all === "1";
  const mine = data.rows.filter((r) => !who || (r.manager ?? "") === who);
  const visible = mine.filter((r) => showAll || !hiddenReason(r));
  const hidden = mine.length - visible.length;
  const sortKey: SortKey = SORT_KEYS.includes(sp.o as SortKey) ? (sp.o as SortKey) : "cost"; // 기본: 이번 달 소진 많은 순
  const sortDir: SortDir = sp.d === "asc" ? "asc" : "desc";
  const matched = visible.filter((r) => !q || `${r.advertiser_name} ${r.customer_id} ${r.client_group ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const shown = sortBy(matched.filter((r) => !status || r.status === status), sortKey, sortDir);
  const counts = (k: string) => matched.filter((r) => r.status === k).length;
  const snap = data.snapshot_date ?? "";
  const s = summarize(visible, snap || "2026-01-01");
  const captured = data.rows.map((r) => r.captured_at).filter(Boolean).sort() as string[];
  const prevLabel = data.rows[0]?.prev_period_start ? `전월 ${data.rows[0].prev_period_start.slice(5).replace("-", ".")}~${(data.rows[0].prev_period_end ?? "").slice(5).replace("-", ".")}` : "전월 같은 기간";
  const managers = [...new Set(data.rows.map((r) => r.manager ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const link = (o: Record<string, string>) => {
    const p = new URLSearchParams({
      ...(who && manager ? { m: who } : {}), ...(status ? { s: status } : {}), ...(q ? { q } : {}), ...(showAll ? { all: "1" } : {}),
      ...(sortKey !== "cost" ? { o: sortKey } : {}), ...(sortDir !== "desc" ? { d: sortDir } : {}), ...o,
    });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/ads?${p.toString()}`;
  };

  // 항목명 누르기: 같은 항목이면 오름/내림 바꾸기, 다른 항목이면 높은 순부터
  const sortTh = (k: SortKey, label: string) => {
    const on = sortKey === k;
    const next: SortDir = on && sortDir === "desc" ? "asc" : "desc";
    return (
      <th key={k} className="px-3 text-right font-medium" aria-sort={on ? (sortDir === "desc" ? "descending" : "ascending") : "none"}>
        <Link href={link({ o: k === "cost" ? "" : k, d: next === "desc" ? "" : next })} className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-brand ${on ? "font-bold text-brand" : ""}`}>
          {label}
          <span className="text-[10px]">{on ? (sortDir === "desc" ? "▼" : "▲") : "↕"}</span>
        </Link>
      </th>
    );
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">비즈머니 현황</h1>
          <p className="text-sm text-ink-soft">
            {snap ? `${Number(snap.slice(5, 7))}월 ${Number(snap.slice(8))}일 아침 ${kstTime(captured[0])}~${kstTime(captured[captured.length - 1])} 확인 기준` : "아침 기록 없음"}
            {" · "}{snap ? `${snap.slice(0, 8)}01 ~ ${snap} (${daysInMonth(snap)}일 중 ${Number(snap.slice(8))}일)` : ""}
            {!manager && " · 내 담당 광고주"}
          </p>
        </div>
        <form className="flex flex-wrap items-center gap-2" action="/ads">
          {manager && (
            <select name="m" defaultValue={who} className="field !w-auto">
              <option value="">전체 담당자</option>
              {managers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <input name="q" defaultValue={q} placeholder="광고주명 또는 Customer ID" className="field !w-56" />
          {status && <input type="hidden" name="s" value={status} />}
          {showAll && <input type="hidden" name="all" value="1" />}
          {sortKey !== "cost" && <input type="hidden" name="o" value={sortKey} />}
          {sortDir !== "desc" && <input type="hidden" name="d" value={sortDir} />}
          <button className="btn btn-ghost">보기</button>
        </form>
      </header>

      <Cards s={s} prevLabel={prevLabel} />

      {manager && !who && (
        <section className="glass overflow-x-auto p-4">
          <h2 className="mb-2 text-sm font-bold">담당자별</h2>
          <table className="w-full min-w-[640px] text-sm tabular-nums">
            <thead className="text-left text-xs text-ink-soft">
              <tr><th className="py-1">담당자</th><th className="text-right">광고주</th><th className="text-right">주의·위험</th><th className="text-right">이번 달 소진</th><th className="text-right">전월 대비</th><th className="text-right">월말 예상</th><th className="text-right">비즈머니</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)]">
              {managers.map((m) => {
                const x = summarize(visible.filter((r) => r.manager === m), snap);
                return (
                  <tr key={m}>
                    <td className="py-2 font-semibold"><Link href={link({ m })} className="hover:text-brand">{m}</Link></td>
                    <td className="text-right">{x.count}</td>
                    <td className="text-right">{x.warning + x.danger ? <span className="text-[var(--warn-ink)]">{x.warning} · <b className="text-danger">{x.danger}</b></span> : "-"}</td>
                    <td className="text-right">{won(x.cost)}</td>
                    <td className="text-right"><Pct now={x.cost} prev={x.prevCost} /></td>
                    <td className="text-right">{won(x.forecast)}</td>
                    <td className="text-right">{won(x.bizmoney)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="glass p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([["", "전체", matched.length], ["danger", "위험", counts("danger")], ["warning", "주의", counts("warning")], ["normal", "정상", counts("normal")], ["transferred", "피이관", counts("transferred")], ["failed", "조회 실패", counts("failed")]] as const)
            .filter(([k, , c]) => !k || c > 0 || k === status)
            .map(([k, label, c]) => {
              const on = status === k;
              const tone = k === "danger" ? "text-danger" : k === "warning" ? "text-[var(--warn-ink)]" : k === "normal" ? "text-[var(--ok-ink)]" : "text-ink-soft";
              return (
                <Link key={k || "all"} href={link({ s: k })} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${on ? "border-brand bg-brand text-white" : "border-[#dbe3ee] bg-white hover:border-brand"}`}>
                  {label}
                  <span className={`rounded-md px-1.5 text-xs tabular-nums ${on ? "bg-white/25 text-white" : `bg-[#f1f4f9] ${tone}`}`}>{c}</span>
                </Link>
              );
            })}
          <span className="ml-auto text-xs text-ink-soft">
            {hidden > 0 && !showAll && <Link href={link({ all: "1" })} className="text-brand underline">이번 달 소진 없는 곳·지난 피이관 {hidden}곳 보기</Link>}
            {showAll && <Link href={link({ all: "" })} className="text-brand underline">소진 없는 곳 숨기기</Link>}
          </span>
        </div>
        <p className="mb-2 text-xs text-ink-soft">
          {shown.length}곳 · {SORT_LABEL[sortKey]} {sortDir === "desc" ? "높은" : "낮은"} 순 · 항목명(▲▼)을 누르면 오름차순/내림차순이 바뀝니다.
        </p>
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[1240px] text-sm tabular-nums">
            <thead>
              <tr className="border-y border-[#edf1f7] bg-[#f8fafd] text-left text-xs text-ink-soft [&>th]:whitespace-nowrap">
                <th className="px-4 py-2.5 font-medium">광고주명</th>
                {manager && <th className="px-3 font-medium">담당자</th>}
                <th className="px-3 font-medium">Customer ID</th>
                <th className="px-3 font-medium">GFA Account ID</th>
                {sortTh("bizmoney", "현재 비즈머니")}
                {sortTh("cost", "이번 달 소진 (VAT 제외)")}
                {sortTh("daily", "일평균 소진 (VAT 제외)")}
                <th className="px-3 text-right font-medium">예상 소진일</th>
                <th className="pl-8 pr-3 text-center font-medium">상태</th>
                <th className="px-4 font-medium">사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf1f7]">
              {shown.map((r: BizRow) => (
                <tr key={r.customer_id} className={"[&>td]:whitespace-nowrap " + (r.status === "danger" ? "bg-[#fff6f7]" : r.status === "warning" ? "bg-[#fffbf0]" : "hover:bg-[#fafbfe]")}>
                  <td className="min-w-[240px] !whitespace-normal px-4 py-3">
                    <p className="font-medium">{r.advertiser_name}</p>
                    {(r.client_group || r.key_source === "advertiser" || r.source === "transferred") && (
                      <p className="text-[11.5px] text-ink-soft">
                        {[r.client_group, r.key_source === "advertiser" ? "광고주 API" : null, r.source === "transferred" ? `피이관 ${r.transferred_at ?? ""}` : null].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </td>
                  {manager && <td className="px-3 font-semibold">{r.manager}</td>}
                  <td className="px-3">{r.customer_id}</td>
                  <td className="px-3 text-ink-soft">{r.gfa_ad_account_no ?? "-"}</td>
                  <td className={`px-3 text-right font-bold ${Number(r.bizmoney ?? 0) < 0 ? "text-danger" : ""}`}>{r.source === "transferred" ? "-" : `${won(Number(r.bizmoney ?? 0))}원`}</td>
                  <td className="px-3 text-right font-bold">{won(netCost(r))}원</td>
                  <td className="px-3 text-right">{won(netDaily(r))}원</td>
                  <td className="px-3 text-right">{r.expected_days == null ? "-" : `${Number(r.expected_days).toFixed(1)}일`}</td>
                  <td className="pl-8 pr-3 text-center"><span className={`chip ${STATUS_LABEL[r.status].chip}`}>{STATUS_LABEL[r.status].label}</span></td>
                  <td className="min-w-[220px] max-w-[320px] !whitespace-normal px-4 text-xs text-ink-soft">{r.reason}{r.error ? ` · ${String(r.error).slice(0, 60)}` : ""}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={10} className="py-8 text-center text-ink-soft">조건에 맞는 광고주가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-soft">
          금액은 VAT 별도(피이관 실적은 원래 VAT 별도). 이번 달 소진은 비즈머니에서 빠져나간 금액이라 검색광고와 GFA(성과형)가 합쳐져 있습니다.
          예상 소진일은 비즈머니 ÷ VAT 포함 일평균. 위험: 잔액 10만원 이하 또는 3일 이하 · 주의: 50만원 이하 또는 7일 이하.
        </p>
      </section>
    </div>
  );
}
