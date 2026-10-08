import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import {
  DEFAULT_CONFIG, autoTargets, computeMonth, goalNotice, monthFull, monthLabel, resultNotice, shiftMonth, teamSum,
  type KeepStatus, type MemberResult, type PromoConfig, type PromoMonth, type Status,
} from "@/lib/monthly-promo";
import { CopyNotice } from "../forms";
import { ConfigForm, MonthEditor } from "./editor";

const won = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`);
const signed = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("ko-KR")}원`);
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

type MonthRow = { month: string; team_target: number | null; team_kind: "sum" | "manual" | null; closed: boolean; memo: string | null };
type MemberRow = {
  month: string; name: string; target: number | null; target_kind: "auto" | "carry" | "manual" | null; actual: number | null; in_team: boolean;
  team_amount: number | null; is_leader: boolean; excluded: boolean; note: string | null; sort_order: number;
};

function Chip({ tone, children }: { tone: "ok" | "bad" | "wait" | "na"; children: React.ReactNode }) {
  const cls = { ok: "chip-ok", bad: "chip-danger", wait: "chip-warn", na: "chip-muted" }[tone];
  return <span className={`chip ${cls} whitespace-nowrap`}>{children}</span>;
}

// 월간 목표 프로모션 (예전 '프로모션 체커')
export default async function MonthlyPromo(props: PageProps<"/promotions/monthly">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!me) return null;
  const manager = me.role !== "staff";
  const [{ data: monthRows }, { data: memberRows }, { data: cfgRow }] = await Promise.all([
    supabase.from("monthly_promo_months").select("month,team_target,team_kind,closed,memo").order("month").returns<MonthRow[]>(),
    supabase.from("monthly_promo_members").select("*").order("sort_order").returns<MemberRow[]>(),
    supabase.from("monthly_promo_config").select("*").eq("id", 1).maybeSingle(),
  ]);
  const cfg: PromoConfig = cfgRow
    ? { bandSize: Number(cfgRow.band_size), bandReward: Number(cfgRow.band_reward), teamReward: Number(cfgRow.team_reward), partial: !!cfgRow.partial, goalStep: Number(cfgRow.goal_step), truncUnit: Number(cfgRow.trunc_unit) }
    : DEFAULT_CONFIG;
  const num = (v: number | null) => (v == null ? null : Number(v));
  const months: Record<string, PromoMonth> = {};
  for (const m of monthRows ?? []) {
    const ym = m.month.slice(0, 7);
    months[ym] = { month: ym, teamTarget: num(m.team_target), teamKind: m.team_kind, closed: m.closed, memo: m.memo ?? "", members: [] };
  }
  for (const r of memberRows ?? []) {
    months[r.month.slice(0, 7)]?.members.push({
      name: r.name, target: num(r.target), actual: num(r.actual), inTeam: r.in_team, teamAmount: num(r.team_amount),
      leader: r.is_leader, excluded: r.excluded, note: r.note ?? "", targetKind: r.target_kind,
    });
  }
  const keys = Object.keys(months).sort();
  const pick = typeof sp.m === "string" && YM.test(sp.m) ? sp.m : "";
  const sel = months[pick] ? pick : (keys.includes(todayKST().slice(0, 7)) ? todayKST().slice(0, 7) : keys[keys.length - 1]);
  const creating = manager && sp.new === "1";
  const editing = manager && !creating && sp.edit === "1" && !!sel;
  const ann = !manager || sp.ann === "1";
  const href = (q: Record<string, string>) => `/promotions/monthly?${new URLSearchParams(q).toString()}`;

  // 새 달: 마지막 달 다음 달, 팀원은 마지막 달 그대로, 목표는 자동 목표
  let editor = null;
  if (creating || editing) {
    const ym = creating ? (keys.length ? shiftMonth(keys[keys.length - 1], 1) : todayKST().slice(0, 7)) : sel;
    const auto = autoTargets(months, ym, cfg);
    const base = creating
      ? (() => {
          const prev = keys.length ? months[keys[keys.length - 1]] : null;
          const members = (prev?.members ?? []).map((m) => ({ ...m, target: auto.members[m.name]?.target ?? null, actual: null, teamAmount: null, excluded: false, note: m.note }));
          return { month: ym, teamTarget: teamSum(members), teamKind: "sum" as const, closed: false, memo: "", members };
        })()
      : { month: ym, teamTarget: months[ym].teamTarget, teamKind: months[ym].teamKind ?? null, closed: months[ym].closed, memo: months[ym].memo, members: months[ym].members };
    editor = (
      <section className="glass p-5">
        <h2 className="mb-3 text-lg font-bold">{creating ? "새 달 입력" : `${monthFull(ym)} 수정`}</h2>
        <MonthEditor key={ym + (creating ? "n" : "e")} initial={base} isNew={creating} auto={auto} prevLabel={monthLabel(shiftMonth(ym, -1))} existing={keys} />
      </section>
    );
  }

  const c = sel ? computeMonth(months, sel, cfg) : null;
  const rows = c ? c.rows.filter((r) => !(ann && r.leader)) : [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">월간 목표 프로모션</h1>
          <p className="text-sm text-ink-soft">월 초에 팀·개인 목표를 넣고, 마감 후 마감액을 채우면 팀 목표 · 개인 목표 · 500만원 상승분(유지형/신규)을 판정합니다.</p>
          <p className="text-xs text-ink-soft"><Link href="/promotions" className="text-brand underline">주간 일소진 프로모션</Link>은 따로 있습니다.</p>
        </div>
        {manager && (
          <div className="flex flex-wrap items-center gap-2">
            {sel && <Link href={href({ m: sel, ...(ann ? {} : { ann: "1" }) })} className="btn btn-ghost !py-1.5 text-xs">{ann ? "팀장 포함해서 보기" : "공지용 보기 (팀장 제외)"}</Link>}
            <Link href={href({ new: "1" })} className="btn !py-1.5 text-xs">+ 다음 달 추가</Link>
          </div>
        )}
      </header>

      {keys.length > 0 && (
        <nav className="flex flex-wrap gap-1.5" aria-label="마감 월">
          {keys.map((k) => (
            <Link key={k} href={href({ m: k, ...(manager && ann ? { ann: "1" } : {}) })} aria-current={k === sel && !creating ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${k === sel && !creating ? "bg-brand text-white" : "bg-white/70 text-ink hover:bg-brand-soft"}`}>
              {monthFull(k)}{!months[k].closed && <span className="ml-1.5 text-[11px] font-normal opacity-80">진행 중</span>}
            </Link>
          ))}
        </nav>
      )}

      {editor}

      {!c && !creating && <p className="glass p-5 text-sm text-ink-soft">아직 입력된 달이 없습니다.{manager ? " 「+ 다음 달 추가」로 시작해 주세요." : ""}</p>}

      {c && !creating && !editing && <MonthView c={c} rows={rows} cfg={cfg} manager={manager} editHref={href({ m: c.month, edit: "1" })} />}

      {manager && (
        <section className="glass p-5">
          <details>
            <summary className="cursor-pointer text-sm font-bold">판정 기준 설정</summary>
            <div className="mt-3"><ConfigForm cfg={cfg} /></div>
          </details>
        </section>
      )}
    </div>
  );
}

function MonthView({ c, rows, cfg, manager, editHref }: { c: NonNullable<ReturnType<typeof computeMonth>>; rows: MemberResult[]; cfg: PromoConfig; manager: boolean; editHref: string }) {
  const t = c.team, fin = c.closed;
  const teamChip: Record<Status, React.ReactNode> = {
    ok: <Chip tone="ok">팀 목표 달성</Chip>, bad: <Chip tone="bad">팀 목표 미달성</Chip>, prog: <Chip tone="wait">진행 중</Chip>,
    wait: <Chip tone="wait">마감 전 · 목표 설정됨</Chip>, na: <Chip tone="na">팀 목표 미입력</Chip>,
  };
  const payRows = rows.filter((r) => !r.excluded);
  const totPay = rows.reduce((s, r) => s + r.pay, 0);
  const totCand = payRows.reduce((s, r) => s + (r.newAmt ?? 0), 0);
  const totPot = payRows.reduce((s, r) => s + r.keepPot, 0);
  const gRows = rows.filter((r) => r.target != null);
  const gOk = gRows.filter((r) => r.actual != null && r.actual >= (r.target ?? 0)).length;
  const p2 = monthLabel(shiftMonth(c.month, -2)), p = monthLabel(c.prevMonth), M = monthLabel(c.month), N = monthLabel(shiftMonth(c.month, 1));
  const w = t.rate == null ? 0 : Math.min(t.rate, 120) / 1.2;
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="팀 목표 달성률" value={t.rate == null ? "—" : `${t.rate.toFixed(2)}%`} sub={t.status === "ok" ? "달성" : t.status === "bad" ? "미달성" : t.status === "prog" ? "진행 중" : "마감 전"} />
        <Kpi label="개인 목표 달성" value={gRows.length ? `${gOk} / ${gRows.length}명` : "—"} sub={fin ? "마감 기준" : "현재 입력 기준"} />
        <Kpi label={fin ? "확정 지급 합계" : "유지 시 지급 가능액"} value={won(fin ? totPay : totPot || totPay)} sub={fin ? "유지형 + 팀 인센티브" : "상승분 유지 조건 충족 시"} />
        <Kpi label="신규 상승 후보" value={won(totCand)} sub="다음 달 유지 확인 후 확정" />
      </section>

      <section className="glass grid gap-5 p-5 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{monthFull(c.month)} 팀 목표</h2>
            {teamChip[t.status]}
          </div>
          <p className="mt-1 text-4xl font-extrabold tabular-nums">{t.rate == null ? won(t.target) : `${t.rate.toFixed(2)}%`}</p>
          {t.rate != null ? (
            <>
              <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-[#e6ecf7]" role="img" aria-label={`팀 목표 대비 ${t.rate.toFixed(1)}%`}>
                <div className="h-full rounded-full bg-brand" style={{ width: `${w}%` }} />
                <div className="absolute inset-y-0 w-[3px] bg-ink" style={{ left: `${100 / 1.2}%` }} />
              </div>
              <p className="mt-1 text-xs text-ink-soft">세로선 = 목표 100%</p>
            </>
          ) : (
            <p className="text-xs text-ink-soft">마감액을 넣으면 달성률이 계산됩니다</p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm tabular-nums [&>dd]:text-right [&>dd]:font-semibold [&>dt]:text-ink-soft">
          <dt>팀 목표</dt><dd>{won(t.target)}</dd>
          <dt>팀 산정 인원 목표 합</dt><dd>{won(t.targetSum)}</dd>
          <dt>팀 산정 마감{fin ? "" : " (현재)"}</dt><dd>{won(t.actual)}{t.actual != null && t.missing ? <span className="text-xs font-normal text-ink-soft"> · {t.missing}명 미입력</span> : null}</dd>
          <dt>{t.gap != null && t.gap < 0 ? (fin ? "부족액" : "남은 금액") : "초과액"}</dt>
          <dd className={t.gap == null ? "" : t.gap < 0 ? "text-danger" : "text-[var(--ok-ink)]"}>{t.gap == null ? "—" : won(Math.abs(t.gap))}</dd>
          <dt>팀 인센티브</dt><dd>{t.status === "ok" ? `${won(cfg.teamReward)} / 1인` : fin ? "없음" : "마감 후 판정"}</dd>
        </dl>
      </section>

      <section className="glass p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold">개인별 {fin ? "판정" : "기준선"}</h2>
            <p className="text-xs text-ink-soft">{fin ? "목표 달성, 상승분 유지, 신규 상승 후보를 팀원별로 판정합니다." : "이번 달 마감에서 넘겨야 할 기준 금액입니다."} 마감액: 서진원 = 네이버(인계건 미포함) + 메타 · 박규진 = 네이버 + 메타 + 바이럴 · 박영서 = 네이버 + 메타</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyNotice text={goalNotice(c)} label="① 개인 목표 공지 복사" />
            <CopyNotice text={resultNotice(c, cfg)} label={fin ? "② 결과 공지 복사" : "② 결과 공지 (중간) 복사"} />
            {manager && <Link href={editHref} className="btn !py-1.5 text-xs">{fin ? "데이터 수정" : "목표·마감 입력"}</Link>}
          </div>
        </div>
        <div className="-mx-4 mt-3 overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm tabular-nums">
            <thead>
              <tr className="border-y border-[#edf1f7] bg-[#f8fafd] text-left text-xs text-ink-soft [&>th]:whitespace-nowrap [&>th]:py-2.5 [&>th]:font-medium">
                <th className="px-4">이름</th><th className="px-3 text-right">목표 / 마감</th><th className="px-3">개인 목표</th><th className="px-3 text-right">전월 대비</th>
                <th className="px-3">기존 상승분 유지 ({p2}→{p})</th><th className="px-3">신규 상승 ({p}→{M})</th><th className="px-4 text-right">{fin ? "당월 확정 지급" : "현재 기준 예상"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf1f7]">
              {rows.map((r) => <MemberLine key={r.name} r={r} M={M} p={p} N={N} closed={fin} />)}
              {!rows.length && <tr><td colSpan={7} className="py-8 text-center text-ink-soft">팀원 데이터가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        {c.memo && <p className="mt-3 rounded-lg border-l-4 border-brand bg-white/60 px-3 py-2 text-xs text-ink-soft">{c.memo}</p>}
        <p className="mt-2 text-xs text-ink-soft">
          {fin ? "확정 지급 = 기존 상승분 유지 인센티브 + 팀 인센티브(달성 시). 신규 상승 후보는 다음 달 유지 여부를 확인한 뒤 그 달에 확정됩니다." : "진행 중인 달입니다. 마감액을 넣고 ‘마감 확정’에 체크하면 지급액이 확정됩니다."} 지급 제외 인원은 0원으로 계산합니다.
        </p>
      </section>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="glass p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11.5px] text-ink-soft">{sub}</p>
    </div>
  );
}

function MemberLine({ r, M, p, N, closed }: { r: MemberResult; M: string; p: string; N: string; closed: boolean }) {
  const goal: Record<Status, React.ReactNode> = {
    ok: <Chip tone="ok">달성</Chip>, bad: <Chip tone="bad">미달성</Chip>,
    prog: r.actual != null && r.target != null && r.actual >= r.target ? <Chip tone="ok">현재 달성</Chip> : <Chip tone="wait">진행 중</Chip>,
    wait: <Chip tone="na">마감 전</Chip>, na: <Chip tone="na">목표 미입력</Chip>,
  };
  const keep: Record<KeepStatus, React.ReactNode> = {
    ok: <Chip tone="ok">유지 충족</Chip>, part: <Chip tone="wait">부분 유지</Chip>, bad: <Chip tone="bad">유지 미충족</Chip>,
    none: <Chip tone="na">대상 아님</Chip>, na: <Chip tone="na">확인 불가</Chip>, wait: <Chip tone="wait">{r.prevBands}구간 · {won(r.keepPot)} 대기</Chip>,
  };
  let newChip: React.ReactNode, newSub = "";
  if (r.newBands == null) {
    newChip = <Chip tone="na">{r.nextLine == null ? "전월 없음" : "마감 전"}</Chip>;
    if (r.nextLine != null) newSub = `${won(r.nextLine)} 이상이면 1구간, 이후 500만원마다 +1`;
  } else if (r.newBands > 0) {
    newChip = <Chip tone="wait">{r.newBands}구간 · {won(r.newAmt)}</Chip>;
    newSub = `${N} 마감에서 ${won(r.actual)} 이상 유지 시 인정`;
  } else {
    newChip = <Chip tone="na">500만원 미만</Chip>;
    if (r.nextLine != null && !closed) newSub = `${won(r.nextLine)} 이상이면 1구간`;
  }
  const kind = r.targetKind === "auto" ? "자동 " : r.targetKind === "carry" ? "유지 " : "";
  return (
    <tr className={`align-top ${r.leader ? "bg-brand-soft/60" : ""}`}>
      <td className="px-4 py-3">
        <p className="font-semibold">{r.name}</p>
        {r.leader && <p className="text-[11px] text-ink-soft">팀장 · 공지 제외</p>}
        {r.inTeam && <p className="text-[11px] text-ink-soft">팀 산정{r.teamAmount != null ? ` ${won(r.teamAmount)}` : ""}</p>}
        {r.excluded && <Chip tone="bad">지급 제외</Chip>}
        {r.note && <p className="text-[11px] text-ink-soft">{r.note}</p>}
      </td>
      <td className="px-3 py-3 text-right">
        <p className="text-xs text-ink-soft">{kind}{won(r.target)}</p>
        <p>{won(r.actual)}</p>
      </td>
      <td className="px-3 py-3">
        {goal[r.goal]}
        <p className="text-xs text-ink-soft">{r.rate != null ? `${r.rate.toFixed(2)}%` : r.goal === "wait" ? `목표 ${won(r.target)}` : ""}</p>
      </td>
      <td className={`px-3 py-3 text-right ${r.delta == null ? "" : r.delta >= 0 ? "text-[var(--ok-ink)]" : "text-danger"}`}>
        {r.delta == null && r.prev != null ? <span className="text-xs text-ink-soft">{p} {won(r.prev)}</span> : signed(r.delta)}
      </td>
      <td className="px-3 py-3">
        {keep[r.keep]}
        {r.prevBands && r.keep !== "wait" ? <p className="text-xs">{r.prevBands}구간 → {won(r.keepAmt)}</p> : null}
        <p className="text-xs text-ink-soft">{r.keepWhy}</p>
      </td>
      <td className="px-3 py-3">
        {newChip}
        {newSub && <p className="text-xs text-ink-soft">{newSub}</p>}
      </td>
      <td className="px-4 py-3 text-right font-bold">
        {r.pending ? "—" : won(r.pay)}
        {r.teamAmt > 0 && !r.excluded && <p className="text-xs font-normal text-ink-soft">팀 {won(r.teamAmt)} 포함</p>}
        {!closed && !r.pending && <p className="text-[11px] font-normal text-ink-soft">{M} 마감 전</p>}
      </td>
    </tr>
  );
}
