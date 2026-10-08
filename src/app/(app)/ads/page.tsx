import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { changePct, daysInMonth, hiddenReason, netCost, netDaily, sortRows, STATUS_LABEL, summarize, type BizRow, type Summary } from "@/lib/ads";
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
  const shown = sortRows(visible.filter((r) => (!status || r.status === status) && (!q || `${r.advertiser_name} ${r.customer_id} ${r.client_group ?? ""}`.toLowerCase().includes(q.toLowerCase()))));
  const snap = data.snapshot_date ?? "";
  const s = summarize(visible, snap || "2026-01-01");
  const captured = data.rows.map((r) => r.captured_at).filter(Boolean).sort() as string[];
  const prevLabel = data.rows[0]?.prev_period_start ? `전월 ${data.rows[0].prev_period_start.slice(5).replace("-", ".")}~${(data.rows[0].prev_period_end ?? "").slice(5).replace("-", ".")}` : "전월 같은 기간";
  const managers = [...new Set(data.rows.map((r) => r.manager ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const link = (o: Record<string, string>) => {
    const p = new URLSearchParams({ ...(who && manager ? { m: who } : {}), ...(status ? { s: status } : {}), ...(q ? { q } : {}), ...(showAll ? { all: "1" } : {}), ...o });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/ads?${p.toString()}`;
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
          <select name="s" defaultValue={status} className="field !w-auto">
            <option value="">모든 상태</option>
            {(["danger", "warning", "failed", "normal", "transferred"] as const).map((k) => <option key={k} value={k}>{STATUS_LABEL[k].label}</option>)}
          </select>
          <input name="q" defaultValue={q} placeholder="광고주·그룹 검색" className="field !w-44" />
          {showAll && <input type="hidden" name="all" value="1" />}
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

      <section className="glass overflow-x-auto p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
          <span>{shown.length}곳 · 위험 → 주의 → 실패 → 정상 순, 같은 상태는 소진 많은 순</span>
          {hidden > 0 && !showAll && <Link href={link({ all: "1" })} className="text-brand underline">이번 달 소진 없는 곳·지난 피이관 {hidden}곳 숨김 · 모두 보기</Link>}
          {showAll && <Link href={link({ all: "" })} className="text-brand underline">소진 없는 곳 숨기기</Link>}
        </div>
        <table className="w-full min-w-[980px] text-sm tabular-nums">
          <thead className="text-left text-xs text-ink-soft">
            <tr>
              <th className="py-1">상태</th><th>광고주</th><th>그룹</th>{manager && <th>담당</th>}
              <th className="text-right">비즈머니</th><th className="text-right">남은 일수</th>
              <th className="text-right">이번 달 소진</th><th className="text-right">전월 같은 기간</th><th className="text-right">일평균</th><th>사유</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-border)]">
            {shown.map((r: BizRow) => (
              <tr key={r.customer_id} className={r.status === "danger" ? "bg-[#fff5f5]" : ""}>
                <td className="py-2"><span className={`chip ${STATUS_LABEL[r.status].chip}`}>{STATUS_LABEL[r.status].label}</span></td>
                <td>
                  <p className="font-semibold">{r.advertiser_name}</p>
                  <p className="text-xs text-ink-soft">{r.customer_id}{r.key_source === "advertiser" ? " · 광고주 API" : ""}{r.source === "transferred" ? ` · 피이관 ${r.transferred_at ?? ""}` : ""}</p>
                </td>
                <td className="text-xs">{r.client_group ?? "-"}</td>
                {manager && <td className="text-xs">{r.manager}</td>}
                <td className="text-right">{r.source === "transferred" ? "-" : `${won(Number(r.bizmoney ?? 0))}원`}</td>
                <td className="text-right">{r.expected_days == null ? "-" : Number(r.expected_days) < 1 ? "1일 미만" : `${Math.floor(Number(r.expected_days))}일`}</td>
                <td className="text-right font-semibold">{won(netCost(r))}원</td>
                <td className="text-right text-ink-soft">{r.prev_total_cost == null ? "-" : `${won(Number(r.prev_total_cost))}원`}<Pct now={netCost(r)} prev={Number(r.prev_total_cost ?? 0)} /></td>
                <td className="text-right">{won(netDaily(r))}원</td>
                <td className="max-w-[220px] text-xs text-ink-soft">{r.reason}{r.error ? ` · ${String(r.error).slice(0, 60)}` : ""}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={10} className="py-6 text-center text-ink-soft">조건에 맞는 광고주가 없습니다.</td></tr>}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-soft">
          금액은 VAT 별도(피이관 실적은 원래 VAT 별도). 남은 일수는 비즈머니 ÷ VAT 포함 일평균. 위험: 잔액 10만원 이하 또는 3일 이하 · 주의: 50만원 이하 또는 7일 이하.
          실시간 새로고침과 캠페인별 성과는 다음 단계에서 옮깁니다 (그때까지는 예전 대시보드 사용).
        </p>
      </section>
    </div>
  );
}
