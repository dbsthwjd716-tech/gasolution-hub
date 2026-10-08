import Link from "next/link";
import type { ReactNode } from "react";
import { todayKST } from "@/lib/billing-calc";
import { followUp } from "@/lib/leads";
import { loadOpenLeads } from "@/lib/leads-data";
import { canViewCost, getMe } from "@/lib/supabase/server";
import { kstTime } from "@/lib/attendance";
import { changePct, hiddenReason, netCost, opsActions, sortRows, STATUS_LABEL, summarize } from "@/lib/ads";
import { fetchBizmoney, fetchPromoSpend } from "@/lib/ads-legacy";
import { addDays, dailySeries, trendEnd } from "@/lib/trend";
import { Icon, type IconName } from "@/components/sidebar-nav";
import { TrendChart } from "@/components/trend-chart";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const TREND_DAYS = 28; // 4주: 같은 요일끼리 비교 (예전 대시보드 조회는 최대 62일)

function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function Kpi({ href, icon, label, value, sub, tone = "brand" }: { href: string; icon: IconName; label: string; value: ReactNode; sub: ReactNode; tone?: "brand" | "danger" | "ok" | "warn" }) {
  const chip = { brand: "bg-brand-soft text-brand", danger: "bg-[#fde8ec] text-danger", ok: "bg-[var(--ok-bg)] text-[var(--ok-ink)]", warn: "bg-[var(--warn-bg)] text-[var(--warn-ink)]" }[tone];
  return (
    <Link href={href} className="glass group block p-5 transition hover:border-[#cddcff]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-soft">{label}</p>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${chip}`}>
          <Icon name={icon} />
        </span>
      </div>
      <p className="mt-1 text-[26px] font-bold leading-tight tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-ink-soft">{sub}</p>
    </Link>
  );
}

type Task = { href: string; icon: IconName; label: string; sub?: string; count: number; tone?: "danger" | "warn" | "info" };

function TaskRow({ t }: { t: Task }) {
  const on = t.count > 0;
  const badge = !on ? "bg-[#f1f4f9] text-[#9aa6bd]" : t.tone === "danger" ? "bg-[#fde8ec] text-danger" : t.tone === "info" ? "bg-brand-soft text-brand" : "bg-[var(--warn-bg)] text-[var(--warn-ink)]";
  return (
    <li>
      <Link href={t.href} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-[#f6f8fc]">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${on ? "bg-brand-soft text-brand" : "bg-[#f4f6fa] text-[#9aa6bd]"}`}>
          <Icon name={t.icon} className="h-[17px] w-[17px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${on ? "" : "text-ink-soft"}`}>{t.label}</span>
          {t.sub && <span className="block truncate text-[11.5px] text-ink-soft">{t.sub}</span>}
        </span>
        <span className={`min-w-[2.25rem] rounded-full px-2 py-0.5 text-center text-xs font-bold tabular-nums ${badge}`}>{t.count}</span>
      </Link>
    </li>
  );
}

function CardHead({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-[15px] font-bold">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

const more = (href: string, label: string) => (
  <Link href={href} className="shrink-0 text-xs font-semibold text-brand hover:underline">{label} ›</Link>
);

export default async function Home() {
  const { supabase, me } = await getMe();
  if (!me) return null;
  const isManager = me.role !== "staff";
  const showCost = canViewCost(me);
  const today = todayKST();
  const ym = today.slice(0, 7);
  const from = `${ym}-01`;
  const to = nextMonth(ym);

  const settle = supabase.from("billing_documents").select("id,doc_type,status,total_amount,payment_received,staff_id,recipient_company_name,document_date");
  const [open, { data: docs }, { data: contracts }, { data: viral }, { data: unpaidViral }, stmts, { data: att }, attWait, biz, { data: adsAcks }, spend, { data: promo }] = await Promise.all([
    loadOpenLeads(supabase),
    isManager ? settle.in("status", ["requested", "lead_approved", "approved", "issued", "rejected"]).limit(1000) : settle.eq("staff_id", me.id).in("status", ["draft", "rejected", "approved", "issued"]).limit(1000),
    supabase.from("contracts").select("id,status,staff_id,client:clients(company_name)").in("status", ["draft", "signing", "rejected"]).limit(500),
    supabase.from("viral_orders_list").select("id,sale_amount,staff_id,payment_received,invoice_status").gte("paid_date", from).lt("paid_date", to).limit(2000),
    supabase.from("viral_orders_list").select("id,staff_id,payment_received,invoice_status").or("payment_received.eq.false,invoice_status.eq.not_issued").limit(3000),
    showCost
      ? supabase.from("viral_partner_statements").select("id,amount,paid,invoice_done")
      : Promise.resolve({ data: [] as { id: string; amount: number; paid: boolean; invoice_done: boolean }[] }),
    supabase.from("attendance_records").select("clock_in,clock_out,is_late,attendance_status").eq("staff_id", me.id).eq("work_date", today).maybeSingle(),
    isManager
      ? Promise.all([
          supabase.from("leave_requests").select("id", { count: "exact", head: true }).or("status.in.(pending,first_approved),cancel_status.not.is.null"),
          supabase.from("attendance_exceptions").select("id", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("attendance_correction_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        ]).then((r) => r.reduce((t, x) => t + (x.count ?? 0), 0))
      : Promise.resolve(0),
    fetchBizmoney(),
    supabase.from("ads_alert_acks").select("alert_key").eq("ack_date", today),
    fetchPromoSpend(addDays(today, -TREND_DAYS * 2 - 4), today),
    supabase.from("promo_weeks").select("id,title,week_start,week_end").lte("week_start", today).gte("week_end", today).maybeSingle(),
  ]);

  // 광고 운영 (직원은 본인 담당만)
  const bizRows = (biz.data?.rows ?? []).filter((r) => isManager || r.manager === me.name);
  const visible = bizRows.filter((r) => !hiddenReason(r));
  const snap = biz.data?.snapshot_date ?? null;
  const s = summarize(visible, snap ?? today);
  const pct = changePct(s.cost, s.prevCost);
  const acked = new Set((adsAcks ?? []).map((a) => a.alert_key));
  const adsOpen = snap ? opsActions(bizRows, biz.data!.previous, snap, biz.data!.previous_date, today).filter((a) => !acked.has(a.key)) : [];
  const adsDanger = adsOpen.filter((a) => a.type === "bizmoney_danger").length;
  const watch = sortRows(visible).filter((r) => r.status === "danger" || r.status === "warning" || r.status === "failed");
  const monitor = (watch.length >= 6 ? watch : [...watch, ...sortRows(visible).filter((r) => !watch.includes(r))]).slice(0, 6);
  const prevLabel = visible[0]?.prev_period_start ? `전월 ${md(visible[0].prev_period_start)}~${md(visible[0].prev_period_end ?? visible[0].prev_period_start)}` : "전월 같은 기간";

  // 광고비 추이 (네이버 유상실적 + 메타)
  const end = spend.data ? trendEnd(spend.data, today) : null;
  const trend = spend.data && end ? dailySeries(spend.data, end, TREND_DAYS, isManager ? null : [me.name]) : null;
  const trendPct = trend ? changePct(trend.curTotal, trend.prevTotal) : null;

  // 인입 문의
  const leads = open.filter((l) => (isManager ? true : l.staff_id === me.id || !l.staff_id)).map((l) => ({ l, f: followUp(l, today) }));
  const needs = leads.filter((x) => x.f.needed).sort((a, b) => b.f.days - a.f.days);
  const unassigned = open.filter((l) => !l.staff_id).length;

  // 정산·견적·계약
  const d = docs ?? [];
  const settlements = d.filter((x) => x.doc_type === "settlement");
  const myTurn = me.role === "ceo" ? d.filter((x) => ["requested", "lead_approved"].includes(x.status)) : me.role === "lead" ? d.filter((x) => x.status === "requested") : [];
  const toIssue = settlements.filter((x) => x.status === "approved");
  const unpaid = settlements.filter((x) => ["approved", "issued"].includes(x.status) && !x.payment_received);
  const rejected = d.filter((x) => x.status === "rejected" && (isManager ? true : x.staff_id === me.id));
  const drafts = d.filter((x) => x.status === "draft");
  const k = (contracts ?? []).filter((x) => isManager || x.staff_id === me.id);
  const signing = k.filter((x) => x.status === "signing");

  // 바이럴
  const v = (viral ?? []).filter((x) => isManager || x.staff_id === me.id);
  const vSales = v.reduce((t, x) => t + Number(x.sale_amount), 0);
  const uv = (unpaidViral ?? []).filter((x) => isManager || x.staff_id === me.id);
  const vNoPay = uv.filter((x) => !x.payment_received).length;
  const vNoInvoice = uv.filter((x) => x.invoice_status === "not_issued").length;
  const st = (stmts.data ?? []) as { amount: number; paid: boolean; invoice_done: boolean }[];
  const stUnpaid = st.filter((x) => !x.paid);

  const sumOf = (rows: { total_amount: number }[]) => (rows.length ? `${won(rows.reduce((t, x) => t + Number(x.total_amount), 0))}원` : undefined);
  const tasks: Task[] = [
    { href: "/ads/today", icon: "pulse", label: isManager ? "광고 점검 필요" : "점검할 내 광고주", sub: adsDanger ? `비즈머니 위험 ${adsDanger}건 포함` : "비즈머니 · 소진 변화 알림", count: adsOpen.length, tone: adsDanger ? "danger" : "warn" },
    ...(isManager
      ? [
          { href: "/billing?t=todo", icon: "receipt", label: "내 승인 차례 (정산 · 견적)", count: myTurn.length } as Task,
          { href: "/attendance/approvals", icon: "clock", label: "근태 결재 대기", sub: "휴가 · 예외 · 기록 수정", count: attWait } as Task,
          { href: "/billing?t=issue", icon: "doc", label: "세금계산서 발행 대기", sub: sumOf(toIssue), count: toIssue.length } as Task,
        ]
      : [
          { href: "/billing?t=all&mine=1", icon: "receipt", label: "작성 중인 내 문서", count: drafts.length, tone: "info" } as Task,
          { href: "/billing?t=rejected", icon: "receipt", label: "반려된 내 문서", count: rejected.length, tone: "danger" } as Task,
        ]),
    { href: "/billing?t=unpaid", icon: "won", label: isManager ? "입금 확인 전 정산" : "입금 확인 전 내 정산", sub: sumOf(unpaid), count: unpaid.length },
    { href: "/contracts", icon: "pen", label: isManager ? "서명 진행 중인 계약" : "서명 진행 중인 내 계약", sub: signing.slice(0, 2).map((x) => (x.client as unknown as { company_name: string } | null)?.company_name).filter(Boolean).join(", ") || undefined, count: signing.length, tone: "info" },
    { href: "/leads?follow=1", icon: "inbox", label: isManager ? "연락이 필요한 문의" : "연락이 필요한 내 문의", sub: unassigned ? `담당 미배정 ${unassigned}건` : "3영업일 연락 없음 · 연락 예정일", count: needs.length },
    { href: "/viral", icon: "megaphone", label: "바이럴 입금 · 계산서 확인", sub: `고객 입금 전 ${vNoPay} · 계산서 미발행 ${vNoInvoice}`, count: vNoPay + vNoInvoice },
    ...(showCost && stUnpaid.length ? [{ href: "/viral/statements?s=unpaid", icon: "megaphone", label: "협력사 견적서 입금 전", sub: `${won(stUnpaid.reduce((t, x) => t + Number(x.amount), 0))}원`, count: stUnpaid.length } as Task] : []),
    ...(isManager && rejected.length ? [{ href: "/billing?t=rejected", icon: "receipt", label: "반려된 문서", count: rejected.length, tone: "danger" } as Task] : []),
  ];
  const waiting = tasks.reduce((t, x) => t + (x.count > 0 ? 1 : 0), 0);

  const day = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" }).format(new Date());

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[#8a97b0]">GA SOLUTION <span className="mx-1 text-[#c3cbd9]">/</span> 통합 홈</p>
          <h1 className="mt-1 text-[24px] font-bold tracking-tight">{me.name}님, 오늘의 현황입니다</h1>
          <p className="mt-0.5 text-sm text-ink-soft">{day} · {isManager ? "회사 전체" : "내 담당"} 광고 운영과 처리할 일을 모았습니다.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-xl border border-[#e4eaf2] bg-white px-3 py-2 text-xs font-semibold text-ink-soft">
          <Icon name="calendar" className="h-4 w-4 text-brand" />
          {snap ? `${md(snap)} 아침 수집 기준` : "수집 기록 없음"}
        </span>
      </header>

      {biz.error && <p className="glass p-4 text-sm text-danger">{biz.error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi href="/ads" icon="wallet" label={isManager ? "이번 달 네이버 소진" : "이번 달 내 네이버 소진"} value={<>{won(s.cost)}<span className="ml-0.5 text-base font-semibold">원</span></>} sub={`VAT 별도 · 월말 예상 ${won(s.forecast)}원`} />
        <Kpi
          href="/ads"
          icon="chart"
          label="전월 같은 기간 대비"
          tone={pct == null ? "brand" : pct >= 0 ? "ok" : "danger"}
          value={pct == null ? <span className="text-ink-soft">비교 불가</span> : <span className={pct >= 0 ? "text-[var(--ok-ink)]" : "text-danger"}>{pct >= 0 ? "+" : ""}{pct}%</span>}
          sub={`${prevLabel} ${won(s.prevCost)}원`}
        />
        <Kpi href="/ads" icon="building" label="소진 중인 광고주" value={<>{s.count}<span className="ml-0.5 text-base font-semibold">곳</span></>} sub={`정상 ${s.normal} · 주의 ${s.warning} · 위험 ${s.danger}${s.failed ? ` · 조회 실패 ${s.failed}` : ""}`} />
        <Kpi href="/ads/today" icon="pulse" label="점검 필요 항목" tone={adsDanger ? "danger" : adsOpen.length ? "warn" : "ok"} value={<>{adsOpen.length}<span className="ml-0.5 text-base font-semibold">건</span></>} sub={adsDanger ? `비즈머니 위험 ${adsDanger}건 먼저 확인` : adsOpen.length ? "오늘의 운영에서 확인" : "오늘 확인할 알림 없음"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="glass p-5 xl:col-span-2">
          <CardHead
            title="광고비 추이"
            sub={end ? `최근 ${TREND_DAYS}일 일별 · 네이버 유상실적 + 메타 · VAT 별도 · ${md(end)}까지 반영` : "네이버 유상실적 + 메타 · VAT 별도"}
            action={more("/ads/spend", "광고비 실적 보기")}
          />
          {trend ? (
            <>
              <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
                <div>
                  <p className="text-xs text-ink-soft">최근 {TREND_DAYS}일 합계</p>
                  <p className="text-xl font-bold tabular-nums">
                    {won(trend.curTotal)}원
                    {trendPct != null && <span className={`ml-2 text-sm font-semibold ${trendPct >= 0 ? "text-[var(--ok-ink)]" : "text-danger"}`}>{trendPct >= 0 ? "▲" : "▼"} {Math.abs(trendPct)}%</span>}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-4 text-xs text-ink-soft">
                  <span className="flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full bg-brand" />최근 {TREND_DAYS}일</span>
                  <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#b9c4d8]" />직전 {TREND_DAYS}일 ({won(trend.prevTotal)}원)</span>
                </div>
              </div>
              <div className="mt-3">
                <TrendChart cur={trend.cur} prev={trend.prev} />
              </div>
            </>
          ) : (
            <p className="mt-6 rounded-xl bg-[#f6f8fc] p-6 text-center text-sm text-ink-soft">{spend.error ?? "아직 집계된 광고비가 없습니다."}</p>
          )}
        </div>

        <div className="glass flex flex-col p-5">
          <CardHead title="오늘의 업무" sub={waiting ? `확인할 항목 ${waiting}개` : "지금 밀린 일이 없습니다"} />
          <ul className="-mx-2 mt-3 flex-1 space-y-0.5">
            {tasks.map((t) => <TaskRow key={t.label} t={t} />)}
          </ul>
          <Link href="/promotions" className="mt-3 flex items-center gap-3 rounded-xl bg-[#f4f7fd] px-3 py-2.5 transition hover:bg-brand-soft">
            <Icon name="gift" className="h-[17px] w-[17px] text-brand" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{promo ? `${promo.title ?? "이번 주"} 프로모션` : "주간 일소진 프로모션"}</span>
            <span className={`chip ${promo ? "chip-info" : "chip-muted"}`}>{promo ? `${md(promo.week_start)}~${md(promo.week_end)} 진행 중` : "진행 중인 주차 없음"}</span>
          </Link>
        </div>
      </section>

      <section className="glass p-5">
        <CardHead title="광고 운영 모니터링" sub={watch.length ? `위험 · 주의 · 조회 실패 ${watch.length}곳을 먼저 보여줍니다` : "주의할 광고주가 없어 소진액 순으로 보여줍니다"} action={more("/ads", "비즈머니 현황 전체")} />
        {monitor.length ? (
          <div className="-mx-5 mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-[#edf1f7] bg-[#f8fafd] text-left text-xs text-ink-soft">
                  <th className="px-5 py-2.5 font-medium">광고주</th>
                  {isManager && <th className="px-3 py-2.5 font-medium">담당자</th>}
                  <th className="px-3 py-2.5 font-medium">구분</th>
                  <th className="px-3 py-2.5 text-right font-medium">이번 달 소진</th>
                  <th className="px-3 py-2.5 text-right font-medium">비즈머니</th>
                  <th className="px-5 py-2.5 text-right font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf1f7]">
                {monitor.map((r) => (
                  <tr key={r.customer_id} className="hover:bg-[#fafbfe]">
                    <td className="px-5 py-3">
                      <Link href={`/ads?q=${encodeURIComponent(r.advertiser_name ?? String(r.customer_id))}`} className="font-semibold hover:text-brand">{r.advertiser_name ?? r.customer_id}</Link>
                      {r.reason && r.status !== "normal" && <p className="max-w-[28ch] truncate text-[11.5px] text-ink-soft">{r.reason}</p>}
                    </td>
                    {isManager && <td className="px-3 py-3 text-ink-soft">{r.manager ?? "-"}</td>}
                    <td className="px-3 py-3 text-ink-soft">{r.source === "transferred" ? "피이관" : "네이버 검색광고"}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{won(netCost(r))}원</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.source === "transferred" ? "-" : `${won(Number(r.bizmoney ?? 0))}원`}</td>
                    <td className="px-5 py-3 text-right"><span className={`chip ${STATUS_LABEL[r.status].chip}`}>{STATUS_LABEL[r.status].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-[#f6f8fc] p-6 text-center text-sm text-ink-soft">표시할 광고주가 없습니다.</p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link href="/attendance" className="glass block p-5 transition hover:border-[#cddcff]">
          <CardHead title="오늘 내 출퇴근" />
          <p className="mt-3 text-xl font-bold tabular-nums">{att?.clock_in ? `${kstTime(att.clock_in)} ~ ${kstTime(att.clock_out) || ""}` : att ? "출근 기록 없음" : "출근 전"}</p>
          <p className="mt-1 text-xs text-ink-soft">{att?.is_late ? "지각 · " : ""}{att?.clock_in ? (att.clock_out ? "퇴근 완료" : "근무 중") : "근태 화면에서 출근하기"}</p>
        </Link>
        <Link href="/viral" className="glass block p-5 transition hover:border-[#cddcff]">
          <CardHead title={isManager ? `${Number(ym.slice(5))}월 바이럴 판매가` : `${Number(ym.slice(5))}월 내 바이럴 판매가`} />
          <p className="mt-3 text-xl font-bold tabular-nums">{won(vSales)}원</p>
          <p className="mt-1 text-xs text-ink-soft">VAT 별도 · {v.length}건 · 입금일 기준</p>
        </Link>
        <div className="glass p-5">
          <CardHead title="연락이 필요한 문의" action={needs.length > 3 ? more("/leads?follow=1", `${needs.length}건 전체`) : undefined} />
          {needs.length ? (
            <ul className="mt-2 divide-y divide-[#edf1f7] text-sm">
              {needs.slice(0, 3).map(({ l, f }) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/leads/${l.id}`} className="truncate font-semibold hover:text-brand">{l.company_name}</Link>
                  <span className="shrink-0 text-xs text-ink-soft">{f.reason}{isManager && l.staff_name ? ` · ${l.staff_name}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">지금 연락이 밀린 문의가 없습니다.</p>
          )}
        </div>
      </section>

      {isManager && (
        <p className="text-xs text-ink-soft">
          급여는 <Link href="/payroll" className="text-brand underline">급여 · 인센티브</Link>에서 매달 초 지난달 실적으로 마감하세요.
        </p>
      )}
    </div>
  );
}
