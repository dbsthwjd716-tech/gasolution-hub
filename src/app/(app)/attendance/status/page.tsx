import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { ATT_STATUS, days, isYm, kstTime, monthDays, weekdayIndex, WEEKDAY } from "@/lib/attendance";
import { requestException, requestLeave, saveRecord, setBalance } from "../actions";
import { BalanceForm, ExceptionForm, LeaveForm, RecordForm } from "../forms";

function shift(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const LEAVE_DAY = ["annual_leave", "family_event", "reward_leave"];

// 대표·팀장: 한 달 근태 현황, 기록 고치기, 연차 현황·조정
export default async function AttendanceStatus(props: PageProps<"/attendance/status">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">대표·팀장만 볼 수 있습니다.</p>;
  const today = todayKST();
  const ym = isYm(typeof sp.m === "string" ? sp.m : null) ? (sp.m as string) : today.slice(0, 7);
  const who = typeof sp.s === "string" ? sp.s : "";
  const year = Number(ym.slice(0, 4));
  const { start, end } = monthDays(ym);

  const [{ data: staff }, { data: records }, { data: summary }, editRow] = await Promise.all([
    supabase.from("staff").select("id,name,is_active").order("name"),
    supabase.from("attendance_records").select("*").gte("work_date", start).lte("work_date", end).order("work_date", { ascending: false }),
    supabase.rpc("leave_summary", { p_year: year }),
    typeof sp.edit === "string" ? supabase.from("attendance_records").select("*").eq("id", Number(sp.edit)).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const active = (staff ?? []).filter((s) => s.is_active);
  const name = new Map((staff ?? []).map((s) => [s.id, s.name] as const));
  const recs = records ?? [];
  const perStaff = active.map((s) => {
    const r = recs.filter((x) => x.staff_id === s.id);
    return {
      ...s,
      worked: r.filter((x) => x.clock_in).length,
      late: r.filter((x) => x.is_late).length,
      early: r.filter((x) => x.is_early_leave).length,
      leave: r.filter((x) => LEAVE_DAY.includes(x.attendance_status)).length,
      noOut: r.filter((x) => x.clock_in && !x.clock_out && x.work_date < today).length,
    };
  });
  const shown = who ? recs.filter((r) => r.staff_id === who) : recs;
  const sum = (summary ?? []) as { staff_id: string; staff_name: string; is_active: boolean; granted: number; adjustment: number; used: number; pending: number; remaining: number }[];
  const e = editRow.data as { staff_id: string; work_date: string; clock_in: string | null; clock_out: string | null; note: string | null } | null;
  const q = (o: Record<string, string>) => "/attendance/status?" + new URLSearchParams({ m: ym, ...(who ? { s: who } : {}), ...o }).toString();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">근태 현황</h1>
          <p className="text-sm text-ink-soft">{year}년 {Number(ym.slice(5))}월 · 대표·팀장만 볼 수 있습니다</p>
        </div>
        <div className="flex gap-1">
          <Link href={`/attendance/status?m=${shift(ym, -1)}`} className="btn btn-ghost">← 이전 달</Link>
          <Link href={`/attendance/status?m=${shift(ym, 1)}`} className="btn btn-ghost">다음 달 →</Link>
        </div>
      </header>

      <section className="glass overflow-x-auto p-5">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr><th className="py-1">직원</th><th className="text-right">출근일</th><th className="text-right">지각</th><th className="text-right">조퇴</th><th className="text-right">종일 휴가</th><th className="text-right">퇴근 누락</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-border)] tabular-nums">
            {perStaff.map((s) => (
              <tr key={s.id} className={who === s.id ? "bg-brand-soft" : ""}>
                <td className="py-2 font-semibold">{s.name}</td>
                <td className="text-right">{s.worked}</td>
                <td className={`text-right ${s.late ? "text-[var(--warn-ink)] font-bold" : ""}`}>{s.late}</td>
                <td className={`text-right ${s.early ? "text-[var(--warn-ink)] font-bold" : ""}`}>{s.early}</td>
                <td className="text-right">{s.leave}</td>
                <td className={`text-right ${s.noOut ? "text-danger font-bold" : ""}`}>{s.noOut}</td>
                <td className="text-right"><Link href={who === s.id ? `/attendance/status?m=${ym}` : `/attendance/status?m=${ym}&s=${s.id}`} className="text-xs text-brand underline">{who === s.id ? "전체 보기" : "기록 보기"}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="glass space-y-3 p-5">
        <h2 className="font-bold">{e ? `${name.get(e.staff_id)} ${e.work_date} 기록 고치기` : "근태 기록 고치기 · 추가"}</h2>
        <RecordForm
          key={typeof sp.edit === "string" ? sp.edit : "new"}
          action={saveRecord}
          staff={active.map((s) => ({ id: s.id, name: s.name }))}
          defaults={e ? { staff_id: e.staff_id, work_date: e.work_date, clock_in: kstTime(e.clock_in), clock_out: kstTime(e.clock_out), note: e.note ?? "" } : who ? { staff_id: who, work_date: today, clock_in: "", clock_out: "", note: "" } : undefined}
        />
      </section>

      <section className="glass overflow-x-auto p-5">
        <h2 className="mb-2 font-bold">{who ? `${name.get(who)} 기록` : "전체 기록"} {shown.length}건</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr><th className="py-1">날짜</th><th>직원</th><th>출근</th><th>퇴근</th><th>상태</th><th>메모</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-border)]">
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="py-2 tabular-nums">{r.work_date.slice(5)} ({WEEKDAY[weekdayIndex(r.work_date)]})</td>
                <td>{name.get(r.staff_id)}</td>
                <td className="tabular-nums">{kstTime(r.clock_in) || "—"}</td>
                <td className="tabular-nums">{kstTime(r.clock_out) || (r.clock_in && r.work_date < today ? <span className="text-danger">누락</span> : "—")}</td>
                <td>
                  {ATT_STATUS[r.attendance_status]}
                  {r.is_late && <span className="chip chip-warn ml-1">지각</span>}
                  {r.is_early_leave && <span className="chip chip-warn ml-1">조퇴</span>}
                </td>
                <td className="text-xs text-ink-soft">{r.note}</td>
                <td className="text-right">
                  {(r.clock_in || (!r.leave_request_id && !r.attendance_exception_id)) && <Link href={q({ edit: String(r.id) })} className="text-xs text-brand underline">고치기</Link>}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={7} className="py-4 text-center text-ink-soft">기록이 없습니다.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="glass space-y-3 p-5">
        <h2 className="font-bold">{year}년 연차 현황</h2>
        <p className="text-xs text-ink-soft">총 연차 = 부여 + 조정. 사용은 최종 승인된 휴가만, 결재 중인 휴가는 따로 표시합니다. 숫자를 바꾸면 이력이 남습니다.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-ink-soft">
              <tr><th className="py-1">직원</th><th>부여 + 조정</th><th className="text-right">사용</th><th className="text-right">결재 중</th><th className="text-right">남음</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)] tabular-nums">
              {sum.map((x) => (
                <tr key={x.staff_id}>
                  <td className="py-2 font-semibold">{x.staff_name}{!x.is_active && <span className="chip chip-muted ml-1">퇴사</span>}</td>
                  <td><BalanceForm action={setBalance} staffId={x.staff_id} year={year} granted={Number(x.granted)} adjustment={Number(x.adjustment)} /></td>
                  <td className="text-right">{days(x.used)}</td>
                  <td className="text-right">{days(x.pending)}</td>
                  <td className={`text-right font-bold ${Number(x.remaining) < 0 ? "text-danger" : ""}`}>{days(x.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="glass space-y-3 p-5">
          <h2 className="font-bold">직원 대신 휴가 신청 넣기</h2>
          <LeaveForm action={requestLeave} today={today} staff={active.map((s) => ({ id: s.id, name: s.name }))} />
        </section>
        <section className="glass space-y-3 p-5">
          <h2 className="font-bold">직원 대신 근태 예외 넣기 (바로 승인 대기로 들어감)</h2>
          <ExceptionForm action={requestException} today={today} staff={active.map((s) => ({ id: s.id, name: s.name }))} />
        </section>
      </div>
    </div>
  );
}
