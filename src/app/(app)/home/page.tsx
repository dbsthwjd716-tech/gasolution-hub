import Link from "next/link";
import { todayKST } from "@/lib/billing-calc";
import { followUp } from "@/lib/leads";
import { loadOpenLeads } from "@/lib/leads-data";
import { canViewCost, getMe } from "@/lib/supabase/server";
import { kstTime } from "@/lib/attendance";
import { opsActions } from "@/lib/ads";
import { fetchBizmoney } from "@/lib/ads-legacy";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// 할 일 카드: 숫자가 0이면 흐리게
function Todo({ href, label, count, sub, tone = "warn" }: { href: string; label: string; count: number; sub?: string; tone?: "warn" | "info" | "danger" }) {
  const on = count > 0;
  const color = tone === "danger" ? "text-danger" : tone === "info" ? "text-brand" : "text-[var(--warn-ink)]";
  return (
    <Link href={href} className={`glass block p-4 transition hover:-translate-y-0.5 ${on ? "" : "opacity-60"}`}>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${on ? color : ""}`}>{count}건</p>
      {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
    </Link>
  );
}

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
  const [open, { data: docs }, { data: contracts }, { data: viral }, { data: unpaidViral }, stmts, { data: att }, attWait, biz, { data: adsAcks }] = await Promise.all([
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
  ]);

  // 광고 운영: 오늘 조치할 알림 (직원은 본인 담당)
  const bizRows = (biz.data?.rows ?? []).filter((r) => isManager || r.manager === me.name);
  const acked = new Set((adsAcks ?? []).map((a) => a.alert_key));
  const adsOpen = biz.data?.snapshot_date ? opsActions(bizRows, biz.data.previous, biz.data.snapshot_date, biz.data.previous_date, today).filter((a) => !acked.has(a.key)) : [];
  const adsDanger = adsOpen.filter((a) => a.type === "bizmoney_danger").length;

  // 연락이 필요한 문의 (직원은 본인 담당 + 미배정, 대표·팀장은 전체)
  const leads = open.filter((l) => (isManager ? true : l.staff_id === me.id || !l.staff_id)).map((l) => ({ l, f: followUp(l, today) }));
  const needs = leads.filter((x) => x.f.needed).sort((a, b) => b.f.days - a.f.days);
  const unassigned = open.filter((l) => !l.staff_id).length;

  // 정산·견적
  const d = docs ?? [];
  const settlements = d.filter((x) => x.doc_type === "settlement");
  const myTurn = me.role === "ceo" ? d.filter((x) => ["requested", "lead_approved"].includes(x.status)) : me.role === "lead" ? d.filter((x) => x.status === "requested") : [];
  const toIssue = settlements.filter((x) => x.status === "approved");
  const unpaid = settlements.filter((x) => ["approved", "issued"].includes(x.status) && !x.payment_received);
  const rejected = d.filter((x) => x.status === "rejected" && (isManager ? true : x.staff_id === me.id));
  const drafts = d.filter((x) => x.status === "draft");

  // 계약
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
  const stInvoice = st.filter((x) => x.paid && !x.invoice_done);

  const day = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" }).format(new Date());

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-ink-soft">{day}</p>
        <h1 className="text-2xl font-bold">{me.name}님, 오늘 할 일</h1>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink-soft">광고 운영</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Todo href="/ads/today" label={isManager ? "지금 조치할 것 (전체)" : "지금 조치할 내 광고주"} count={adsOpen.length} sub={adsDanger ? `비즈머니 위험 ${adsDanger}건` : "비즈머니·소진 변화 알림"} tone={adsDanger ? "danger" : "warn"} />
          <Link href="/ads" className="glass block p-4 transition hover:-translate-y-0.5">
            <p className="text-xs text-ink-soft">{isManager ? "이번 달 네이버 소진 (VAT 별도)" : "이번 달 내 네이버 소진 (VAT 별도)"}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{won(bizRows.reduce((t, r) => t + (r.source === "transferred" ? Number(r.gross_total_cost ?? 0) : Number(r.gross_total_cost ?? 0) / 1.1), 0))}원</p>
            <p className="mt-0.5 text-xs text-ink-soft">{biz.data?.snapshot_date ? `${md(biz.data.snapshot_date)} 아침 기준` : biz.error ?? ""}</p>
          </Link>
          <Link href="/ads/spend" className="glass block p-4 transition hover:-translate-y-0.5">
            <p className="text-xs text-ink-soft">광고비 실적</p>
            <p className="mt-1 text-sm font-semibold">그룹별 검색광고·GFA·메타 보기 →</p>
          </Link>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink-soft">근태</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/attendance" className="glass block p-4 transition hover:-translate-y-0.5">
            <p className="text-xs text-ink-soft">오늘 내 출퇴근</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {att?.clock_in ? `${kstTime(att.clock_in)} ~ ${kstTime(att.clock_out) || ""}` : att ? "출근 기록 없음" : "출근 전"}
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">{att?.is_late ? "지각 · " : ""}{att?.clock_in ? (att.clock_out ? "퇴근 완료" : "근무 중") : "근태 화면에서 출근하기"}</p>
          </Link>
          {isManager && <Todo href="/attendance/approvals" label="근태 결재 대기 (휴가·예외·수정)" count={attWait} />}
          <Link href="/attendance/calendar" className="glass block p-4 transition hover:-translate-y-0.5">
            <p className="text-xs text-ink-soft">근태 달력</p>
            <p className="mt-1 text-sm font-semibold">누가 언제 쉬는지 보기 →</p>
          </Link>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink-soft">인입 문의</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Todo href="/leads?follow=1" label={isManager ? "연락이 필요한 문의 (전체)" : "연락이 필요한 내 문의"} count={needs.length} sub="3영업일 연락 없음 또는 연락 예정일 도래" />
          <Todo href="/leads?owner=none" label="담당 미배정 문의" count={unassigned} tone="info" />
          <Todo href="/leads?view=board" label={isManager ? "진행 중인 문의 (전체)" : "진행 중인 내 문의"} count={leads.length} tone="info" />
        </div>
        {needs.length > 0 && (
          <ul className="glass divide-y divide-[var(--glass-border)] text-sm">
            {needs.slice(0, 6).map(({ l, f }) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <Link href={`/leads/${l.id}`} className="font-semibold hover:text-brand">{l.company_name}</Link>
                <span className="text-xs text-ink-soft">{l.status} · {f.reason}{isManager && l.staff_name ? ` · ${l.staff_name}` : ""}</span>
              </li>
            ))}
            {needs.length > 6 && <li className="px-4 py-2 text-xs"><Link href="/leads?follow=1" className="text-brand underline">{needs.length - 6}건 더 보기</Link></li>}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink-soft">정산 · 견적 · 계약</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {isManager ? (
            <>
              <Todo href="/billing?t=todo" label="내 승인 차례" count={myTurn.length} />
              <Todo href="/billing?t=issue" label="세금계산서 발행 대기" count={toIssue.length} sub={toIssue.length ? `${won(toIssue.reduce((t, x) => t + Number(x.total_amount), 0))}원` : undefined} />
            </>
          ) : (
            <>
              <Todo href="/billing?t=all&mine=1" label="작성 중인 내 문서" count={drafts.length} tone="info" />
              <Todo href="/billing?t=rejected" label="반려된 내 문서" count={rejected.length} tone="danger" />
            </>
          )}
          <Todo href="/billing?t=unpaid" label={isManager ? "입금 확인 전 정산" : "입금 확인 전 내 정산"} count={unpaid.length} sub={unpaid.length ? `${won(unpaid.reduce((t, x) => t + Number(x.total_amount), 0))}원` : undefined} />
          <Todo href="/contracts" label={isManager ? "서명 진행 중인 계약" : "서명 진행 중인 내 계약"} count={signing.length} sub={signing.slice(0, 2).map((x) => (x.client as unknown as { company_name: string } | null)?.company_name).filter(Boolean).join(", ") || undefined} tone="info" />
          {isManager && rejected.length > 0 && <Todo href="/billing?t=rejected" label="반려된 문서" count={rejected.length} tone="danger" />}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink-soft">바이럴 · {Number(ym.slice(5))}월</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/viral" className="glass block p-4 transition hover:-translate-y-0.5">
            <p className="text-xs text-ink-soft">{isManager ? "이번 달 판매가 (VAT 별도)" : "이번 달 내 판매가 (VAT 별도)"}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{won(vSales)}원</p>
            <p className="mt-0.5 text-xs text-ink-soft">{v.length}건 · 입금일 기준</p>
          </Link>
          <Todo href="/viral" label="고객 입금 전" count={vNoPay} />
          <Todo href="/viral" label="세금계산서 미발행" count={vNoInvoice} />
          {showCost && (
            <Todo
              href="/viral/statements?s=unpaid"
              label="협력사 견적서 입금 전"
              count={stUnpaid.length}
              sub={stUnpaid.length ? `${won(stUnpaid.reduce((t, x) => t + Number(x.amount), 0))}원` : stInvoice.length ? `입금 후 세금계산서 미발행 ${stInvoice.length}건` : undefined}
            />
          )}
        </div>
      </section>

      {isManager && (
        <p className="text-xs text-ink-soft">
          급여는 <Link href="/payroll" className="text-brand underline">급여 · 인센티브</Link>에서 매달 초 지난달 실적으로 마감하세요. 오늘 {md(today)} 기준.
        </p>
      )}
    </div>
  );
}
