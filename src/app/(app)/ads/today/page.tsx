import Link from "next/link";
import type { ReactNode } from "react";
import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { jobState, opsActions, roasActions, type JobState, type OpsAction } from "@/lib/ads";
import { fetchBizmoney, fetchOpsStatus, fetchRoasWatch } from "@/lib/ads-legacy";
import { followUp } from "@/lib/leads";
import { loadOpenLeads } from "@/lib/leads-data";
import { cycleLabel, dueToday, type Routine } from "@/lib/routines";
import { ackAlerts } from "../actions";
import { CheckSection, type CheckItem } from "../check-list";
import { addRoutine, completeRoutines, logLeadContact, uncheckRoutine } from "../ops-actions";
import { LeadContactForm, RoutineForm } from "../ops-forms";

// 요청 시점의 시각 (화면을 그릴 때마다 바뀌는 값이라 따로 받음)
async function serverNow() {
  return Date.now();
}

const kst = (ts: string | null | undefined) =>
  ts ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)) : "";
const kstDate = (ts: string) => new Date(Date.parse(ts) + 9 * 3600000).toISOString().slice(0, 10);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const TONE: Record<JobState["state"] | "off", string> = { ok: "chip-ok", error: "chip-danger", pending: "chip-warn", off: "chip-muted" };

type RoutineRow = Routine & { title: string; advertiser_name: string | null; staff_id: string; due_time: string | null; memo: string | null; staff: { name: string } | null };

// 오늘의 운영: ① 비즈머니 ② 소진 급변 ③ 수익률 급변 ④ 광고주 루틴·약속 ⑤ 인입 문의 재연락
//   모두 직접 '확인' 버튼을 눌러야 끝남. 직원은 본인 담당, 대표·팀장은 전체 또는 담당자 선택
export default async function OpsToday(props: PageProps<"/ads/today">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!me) return null;
  const manager = me.role !== "staff";
  const today = todayKST();
  const back = new Date(Date.parse(`${today}T00:00:00Z`) - 46 * 86400000).toISOString().slice(0, 10);
  const [biz, st, roas, { data: acks }, { data: routines }, { data: checks }, leads, { data: acts }, { data: staffList }] = await Promise.all([
    fetchBizmoney(),
    fetchOpsStatus(),
    fetchRoasWatch(),
    supabase.from("ads_alert_acks").select("alert_key,staff_id,created_at,staff:staff_id(name)").eq("ack_date", today),
    supabase.from("ops_routines").select("id,title,advertiser_name,staff_id,kind,weekdays,month_day,due_date,due_time,start_date,is_active,memo,staff:staff_id(name)").eq("is_active", true).returns<RoutineRow[]>(),
    supabase.from("ops_routine_checks").select("routine_id,due_date,done_at").gte("due_date", back),
    loadOpenLeads(supabase),
    supabase.from("lead_activities").select("lead_id,occurred_at,actor_id").in("activity_type", ["전화", "문자", "카카오톡", "이메일", "미팅", "제안서", "기타"]).gte("occurred_at", `${today}T00:00:00+09:00`),
    supabase.from("staff").select("id,name").eq("is_active", true).order("name"),
  ]);

  const names = [...new Set([...(biz.data?.rows ?? []).map((r) => r.manager ?? ""), ...(staffList ?? []).map((x) => x.name)].filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const who = manager ? (typeof sp.m === "string" ? sp.m : "") : me.name;
  const mine = (name: string | null | undefined) => !who || name === who;
  const ackBy = new Map((acks ?? []).map((a) => [a.alert_key, a]));

  // ① ② 비즈머니·소진 급변 (아침 기록), ③ 수익률 (검색광고 어제)
  const rows = (biz.data?.rows ?? []).filter((r) => mine(r.manager));
  const base = biz.data?.snapshot_date ? opsActions(rows, biz.data.previous, biz.data.snapshot_date, biz.data.previous_date, today) : [];
  const bizList = base.filter((a) => a.type.startsWith("bizmoney"));
  const spendList = base.filter((a) => a.type.startsWith("spend"));
  const roasList = roas.data?.date ? roasActions(roas.data.rows.filter((r) => mine(r.manager)), roas.data.date, today) : [];

  // ④ 루틴·약속
  const doneDates = new Map<string, Set<string>>();
  for (const c of checks ?? []) doneDates.set(c.routine_id, (doneDates.get(c.routine_id) ?? new Set()).add(c.due_date));
  const myRoutines = (routines ?? []).filter((r) => mine(r.staff?.name));
  const routineOpen = myRoutines
    .map((r) => ({ r, due: dueToday(r, today, doneDates.get(r.id) ?? new Set()) }))
    .filter((x): x is { r: RoutineRow; due: { date: string; late: number } } => !!x.due)
    .sort((a, b) => b.due.late - a.due.late || (a.r.due_time ?? "99").localeCompare(b.r.due_time ?? "99"));
  const routineDone = (checks ?? []).filter((c) => kstDate(c.done_at) === today && myRoutines.some((r) => r.id === c.routine_id));

  // ⑤ 인입 문의 재연락
  const scopeLeads = leads.filter((l) => (who ? l.staff_name === who || (!l.staff_id && !manager) : true));
  const leadOpen = scopeLeads.map((l) => ({ l, f: followUp(l, today) })).filter((x) => x.f.needed).sort((a, b) => b.f.days - a.f.days);
  const contactedToday = new Set((acts ?? []).filter((a) => scopeLeads.some((l) => l.id === a.lead_id)).map((a) => a.lead_id));

  // 진행률
  const alerts = [...bizList, ...spendList, ...roasList];
  const alertDone = alerts.filter((a) => ackBy.has(a.key)).length;
  const total = alerts.length + routineOpen.length + routineDone.length + leadOpen.length + contactedToday.size;
  const done = alertDone + routineDone.length + contactedToday.size;
  const pct = total ? Math.round((done / total) * 100) : 100;

  // 자동 수집 상태
  const nowMs = await serverNow();
  const now = new Date(nowMs + 9 * 3600000);
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const s = st.data;
  const status: { name: string; state: JobState["state"] | "off"; label: string }[] = s
    ? [
        { name: "비즈머니 아침 확인", ...jobState(s.runs, "bizmoney-snapshot", 10.5, hour), ...(biz.data?.snapshot_date !== today ? { state: "error" as const, label: `최근 기록 ${biz.data?.snapshot_date ?? "없음"}` } : {}) },
        { name: "아침 자동 수집", ...jobState(s.runs, "daily-sync", 11, hour) },
        { name: "검색광고 어제 실적", state: s.searchad_targets > 0 && s.searchad_done >= s.searchad_targets ? "ok" : hour < 13.5 ? "pending" : "error", label: `${s.searchad_done}/${s.searchad_targets}곳` },
        { name: "메타 광고비", state: !s.meta_accounts.length ? "off" : s.meta_accounts.some((a) => !a.last_synced_at || nowMs - Date.parse(a.last_synced_at) > 26 * 3600000) ? "error" : "ok", label: `${s.meta_accounts.length}개 계정` },
      ]
    : [];
  const advertisers = [...new Set(rows.map((r) => r.advertiser_name ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const canAck = (a: OpsAction) => manager || a.manager === me.name;
  const alertSection = (title: string, hint: string, list: OpsAction[]) => {
    const open = list.filter((a) => !ackBy.has(a.key));
    const done = list.filter((a) => ackBy.has(a.key));
    return (
      <CheckSection
        title={title}
        hint={hint}
        action={ackAlerts}
        items={open.map((a): CheckItem => ({
          key: a.key,
          disabled: !canAck(a),
          content: (
            <>
              <p>
                <span className={`chip ${a.severity === 1 ? "chip-danger" : a.severity === 2 ? "chip-warn" : "chip-info"} mr-2`}>{a.label}</span>
                <b>{a.advertiserName}</b>{manager && <span className="ml-1 text-xs text-ink-soft">· {a.manager}</span>}
              </p>
              <p className="mt-0.5 tabular-nums">{a.title}</p>
              <p className="text-xs text-ink-soft">{a.detail}</p>
            </>
          ),
        }))}
        empty={done.length ? "모두 확인했습니다." : "오늘 확인할 것이 없습니다."}
        done={done.length ? (
          <details className="mt-2 text-xs text-ink-soft">
            <summary className="cursor-pointer">오늘 확인 {done.length}건</summary>
            <ul className="mt-1 space-y-1">
              {done.map((a) => {
                const k = ackBy.get(a.key) as Ack | undefined;
                return <li key={a.key}>✓ {a.label} · {a.advertiserName} — {k?.staff?.name ?? ""} {kst(k?.created_at)}</li>;
              })}
            </ul>
          </details>
        ) : null}
      />
    );
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">오늘의 운영</h1>
          <p className="text-sm text-ink-soft">{manager ? (who ? `${who} 담당` : "전체 담당") : "내 담당"} · 항목마다 직접 확인 버튼을 눌러야 오늘 할 일이 끝납니다</p>
        </div>
        {manager && (
          <form action="/ads/today" className="flex gap-2">
            <select name="m" defaultValue={who} className="field !w-auto" aria-label="담당자">
              <option value="">전체 담당자</option>
              {names.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="btn btn-ghost">보기</button>
          </form>
        )}
      </header>

      <section className="glass p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="text-sm font-bold">오늘 할 일 {done} / {total}</p>
          <p className={`text-sm font-bold ${pct === 100 ? "text-[var(--ok-ink)]" : "text-brand"}`}>{pct === 100 ? "오늘 할 일을 모두 끝냈습니다" : `${pct}% 완료`}</p>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#edf1f7]">
          <div className={`h-full rounded-full ${pct === 100 ? "bg-[var(--ok-ink)]" : "bg-brand"}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
          <span>비즈머니 {bizList.filter((a) => !ackBy.has(a.key)).length}건 남음</span>
          <span>소진 급변 {spendList.filter((a) => !ackBy.has(a.key)).length}건</span>
          <span>수익률 급변 {roasList.filter((a) => !ackBy.has(a.key)).length}건</span>
          <span>루틴·약속 {routineOpen.length}건</span>
          <span>문의 재연락 {leadOpen.length}건</span>
        </div>
      </section>

      {alertSection("비즈머니 체크", "잔액이 적거나 곧 바닥나는 광고주 (이번 달 소진이 있는 곳만)", bizList)}
      {alertSection("어제 대비 소진 급변", "최근 24시간 소진이 평소 일평균 대비 ±50% 이상이거나 0원인 곳", spendList)}
      {alertSection(
        "수익률 급변",
        roas.data?.date ? `어제(${md(roas.data.date)}) 검색광고 수익률이 그 전 7일보다 ±50% 이상 바뀐 곳` : roas.error ?? "검색광고 수집 기록 없음",
        roasList,
      )}

      <CheckSection
        title="광고주 루틴 · 약속"
        hint="보고서 발송·순위 체크처럼 정해 둔 일과 광고주와 약속한 일"
        action={completeRoutines}
        button="완료"
        allLabel="이 항목 모두 완료"
        empty="오늘 남은 루틴·약속이 없습니다."
        items={routineOpen.map(({ r, due }): CheckItem => ({
          key: `${r.id}|${due.date}`,
          content: (
            <>
              <p>
                {due.late > 0 && <span className="chip chip-danger mr-1.5">{due.late}일 지남</span>}
                <b>{r.title}</b>
                {r.advertiser_name && <span className="ml-1.5 text-ink-soft">· {r.advertiser_name}</span>}
                {manager && !who && <span className="ml-1 text-xs text-ink-soft">· {r.staff?.name}</span>}
              </p>
              <p className="text-xs text-ink-soft">{cycleLabel(r)}{due.late > 0 ? ` · 원래 ${md(due.date)}` : ""}{r.memo ? ` · ${r.memo}` : ""}</p>
            </>
          ),
        }))}
        done={routineDone.length > 0 ? (
          <details className="mt-2 text-xs text-ink-soft">
            <summary className="cursor-pointer">오늘 완료 {routineDone.length}건</summary>
            <ul className="mt-1 space-y-1">
              {routineDone.map((c) => {
                const r = myRoutines.find((x) => x.id === c.routine_id);
                return (
                  <li key={`${c.routine_id}|${c.due_date}`} className="flex items-center gap-2">
                    ✓ {r?.title}{r?.advertiser_name ? ` · ${r.advertiser_name}` : ""} — {kst(c.done_at)}
                    <form action={uncheckRoutine.bind(null, c.routine_id, c.due_date)}><button className="underline">되돌리기</button></form>
                  </li>
                );
              })}
            </ul>
          </details>
        ) : null}
        extra={
          <details className="mt-3 rounded-xl bg-[#f6f8fc] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-brand">+ 루틴·약속 추가 <Link href="/ads/routines" className="ml-2 text-xs font-normal underline">관리 화면</Link></summary>
            <div className="mt-3">
              <RoutineForm action={addRoutine} staff={manager ? (staffList ?? []) : []} advertisers={advertisers} defaultStaff={me.id} />
            </div>
          </details>
        }
      />

      <Section title="인입 문의 재연락" count={leadOpen.length} hint="3영업일 넘게 연락이 없거나 연락 예정일이 된 문의. 연락 방법을 고르고 「연락함」을 눌러야 빠집니다" action={<Link href="/leads?follow=1" className="text-xs font-semibold text-brand hover:underline">문의 화면 ›</Link>}>
        <ul className="divide-y divide-[#edf1f7] text-sm">
          {leadOpen.slice(0, 30).map(({ l, f }) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p><Link href={`/leads/${l.id}`} className="font-semibold hover:text-brand">{l.company_name}</Link><span className="ml-1.5 text-xs text-ink-soft">{l.status}{manager && !who && l.staff_name ? ` · ${l.staff_name}` : ""}</span></p>
                <p className="text-xs text-ink-soft">{f.reason}{l.contact_name ? ` · ${l.contact_name}` : ""}{l.phone ? ` · ${l.phone}` : ""}</p>
              </div>
              <LeadContactForm action={logLeadContact.bind(null, l.id)} />
            </li>
          ))}
          {leadOpen.length > 30 && <li className="py-2 text-xs"><Link href="/leads?follow=1" className="text-brand underline">{leadOpen.length - 30}건 더 보기</Link></li>}
          {!leadOpen.length && <li className="py-2 text-ink-soft">다시 연락할 문의가 없습니다.</li>}
        </ul>
        {contactedToday.size > 0 && <p className="mt-2 text-xs text-ink-soft">오늘 연락 기록 {contactedToday.size}건</p>}
      </Section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {status.map((x) => (
          <div key={x.name} className="glass flex items-center justify-between p-3">
            <p className="text-xs text-ink-soft">{x.name}</p>
            <span className={`chip ${TONE[x.state]}`}>{x.label}</span>
          </div>
        ))}
      </section>
      <p className="text-xs text-ink-soft">확인 처리는 오늘 하루만 유지됩니다. <Link href="/ads" className="text-brand underline">비즈머니 현황 보기</Link></p>
    </div>
  );
}

function Section({ title, count, hint, action, children }: { title: string; count: number; hint: string; action?: ReactNode; children: ReactNode }) {
  return (
    <details className="glass group p-0">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4">
        <span className="text-[11px] text-ink-soft transition group-open:rotate-90">▶</span>
        <span className="font-bold">{title}</span>
        <span className={`rounded-md px-2 py-0.5 text-sm font-bold tabular-nums ${count ? "bg-[var(--warn-bg)] text-[var(--warn-ink)]" : "bg-[var(--ok-bg)] text-[var(--ok-ink)]"}`}>{count ? `${count}곳 남음` : "완료"}</span>
        <span className="hidden text-xs text-ink-soft sm:inline">{hint}</span>
        <span className="ml-auto text-xs text-brand group-open:hidden">펼치기</span>
        <span className="ml-auto hidden text-xs text-ink-soft group-open:inline">접기</span>
      </summary>
      <div className="border-t border-[#edf1f7] px-5 pb-4 pt-3">
        <div className="mb-2 flex justify-end">{action}</div>
        {children}
      </div>
    </details>
  );
}

type Ack = { staff?: { name: string } | null; created_at: string };
