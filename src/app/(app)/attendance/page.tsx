import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { ATT_STATUS, CANCEL_STATUS, EXCEPTION_STATUS, EXCEPTION_TYPE, LEAVE_STATUS, LEAVE_TYPE, days, isYm, kstTime, monthDays, weekdayIndex, WEEKDAY } from "@/lib/attendance";
import { act, requestCorrection, requestException, requestLeave, requestLeaveCancel } from "./actions";
import { ActButton, CancelLeaveForm, ClockButtons, CorrectionForm, ExceptionForm, LeaveForm } from "./forms";

function shift(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const FULL_DAY = ["annual_leave", "family_event", "reward_leave", "other"];

export default async function MyAttendance(props: PageProps<"/attendance">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!me) return null;
  const today = todayKST();
  const ym = isYm(typeof sp.m === "string" ? sp.m : null) ? (sp.m as string) : today.slice(0, 7);
  const { start, end } = monthDays(ym);
  const year = Number(today.slice(0, 4));

  const [{ data: todayRec }, { data: holiday }, { data: records }, { data: summary }, { data: leaves }, { data: exceptions }, { data: corrections }, { data: hr }] = await Promise.all([
    supabase.from("attendance_records").select("*").eq("staff_id", me.id).eq("work_date", today).maybeSingle(),
    supabase.from("company_holidays").select("holiday_name").eq("holiday_date", today).maybeSingle(),
    supabase.from("attendance_records").select("*").eq("staff_id", me.id).gte("work_date", start).lte("work_date", end).order("work_date"),
    supabase.rpc("leave_summary", { p_year: year }),
    supabase.from("leave_requests").select("*").eq("staff_id", me.id).gte("end_date", `${year - 1}-12-01`).order("start_date", { ascending: false }).limit(60),
    supabase.from("attendance_exceptions").select("*").eq("staff_id", me.id).gte("work_date", `${year - 1}-12-01`).order("work_date", { ascending: false }).limit(60),
    supabase.from("attendance_correction_requests").select("attendance_record_id,status").eq("staff_id", me.id).eq("status", "pending"),
    supabase.from("staff_hr").select("work_type").eq("staff_id", me.id).maybeSingle(),
  ]);
  const mine = ((summary ?? []) as { staff_id: string; granted: number; adjustment: number; used: number; pending: number; remaining: number }[]).find((x) => x.staff_id === me.id);
  const pendingCorr = new Set((corrections ?? []).map((c) => c.attendance_record_id));
  const weekend = weekdayIndex(today) >= 5;
  const blocked = weekend
    ? "오늘은 주말입니다."
    : holiday
      ? `오늘은 휴일입니다 (${holiday.holiday_name}).`
      : todayRec && !todayRec.clock_in && FULL_DAY.includes(todayRec.attendance_status)
        ? `오늘은 ${ATT_STATUS[todayRec.attendance_status]}입니다. 출퇴근 처리가 필요 없습니다.`
        : undefined;
  const lateCount = (records ?? []).filter((r) => r.is_late).length;
  const earlyCount = (records ?? []).filter((r) => r.is_early_leave).length;

  return (
    <div className="space-y-4">
      <section className="glass flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-ink-soft">오늘 {Number(today.slice(5, 7))}월 {Number(today.slice(8))}일 ({WEEKDAY[weekdayIndex(today)]}) · {hr?.work_type === "flexible" ? "시차근무" : "기본근무"}</p>
          <p className="mt-1 text-xl font-bold tabular-nums">
            출근 {kstTime(todayRec?.clock_in) || "—"} · 퇴근 {kstTime(todayRec?.clock_out) || "—"}
            {todayRec?.is_late && <span className="chip chip-warn ml-2">지각</span>}
            {todayRec?.is_early_leave && <span className="chip chip-warn ml-2">조퇴</span>}
          </p>
        </div>
        <ClockButtons action={act} clockIn={todayRec?.clock_in ?? ""} clockOut={todayRec?.clock_out ?? ""} blocked={blocked} />
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ["올해 연차 (부여+조정)", mine ? days(Number(mine.granted) + Number(mine.adjustment)) : "등록 전"],
          ["사용", mine ? days(mine.used) : "-"],
          ["결재 중", mine ? days(mine.pending) : "-"],
          ["남은 연차", mine ? days(mine.remaining) : "-"],
        ].map(([k, v]) => (
          <div key={k} className="glass p-4">
            <p className="text-xs text-ink-soft">{k}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{v}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="glass space-y-3 p-5">
          <h2 className="font-bold">휴가 신청</h2>
          <LeaveForm action={requestLeave} today={today} />
        </section>
        <section className="glass space-y-3 p-5">
          <h2 className="font-bold">기타 근태 · 미팅 · 조기퇴근 신청</h2>
          <ExceptionForm action={requestException} today={today} />
        </section>
      </div>

      <section className="glass space-y-3 p-5">
        <h2 className="font-bold">내 신청 내역</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-ink-soft">
              <tr><th className="py-1">종류</th><th>날짜</th><th>일수·시간</th><th>내용</th><th>상태</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)]">
              {(leaves ?? []).map((l) => (
                <tr key={`l${l.id}`}>
                  <td className="py-2 font-semibold">{LEAVE_TYPE[l.leave_type]}</td>
                  <td className="tabular-nums">{l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ""}</td>
                  <td>{days(l.leave_days)}{!l.deduct_leave && <span className="ml-1 text-xs text-ink-soft">(차감 없음)</span>}</td>
                  <td className="max-w-[260px] whitespace-pre-line text-xs text-ink-soft">{l.reason}{l.decided_note ? `\n반려 사유: ${l.decided_note}` : ""}</td>
                  <td>
                    <span className={`chip ${LEAVE_STATUS[l.status].chip}`}>{LEAVE_STATUS[l.status].label}</span>
                    {l.cancel_status && <span className="chip chip-warn ml-1">{CANCEL_STATUS[l.cancel_status]}</span>}
                  </td>
                  <td className="text-right">
                    {["pending", "first_approved"].includes(l.status) && <ActButton action={act} op="leave_withdraw" id={l.id} label="거둬들이기" tone="danger" confirmText="이 신청을 거둬들일까요?" />}
                    {l.status === "approved" && !l.cancel_status && l.end_date >= today && <CancelLeaveForm action={requestLeaveCancel} id={l.id} />}
                  </td>
                </tr>
              ))}
              {(exceptions ?? []).map((e) => (
                <tr key={`e${e.id}`}>
                  <td className="py-2 font-semibold">{EXCEPTION_TYPE[e.exception_type]}</td>
                  <td className="tabular-nums">{e.work_date}</td>
                  <td className="text-xs tabular-nums">
                    {e.approved_leave_time ? `${e.approved_leave_time.slice(0, 5)} 퇴근` : e.start_time ? `${e.start_time.slice(0, 5)}${e.end_time ? ` ~ ${e.end_time.slice(0, 5)}` : ""}` : "종일"}
                  </td>
                  <td className="max-w-[260px] text-xs text-ink-soft">{[e.location, e.note].filter(Boolean).join(" · ")}</td>
                  <td><span className={`chip ${EXCEPTION_STATUS[e.status].chip}`}>{EXCEPTION_STATUS[e.status].label}</span></td>
                  <td className="text-right">
                    {e.status === "pending" && <ActButton action={act} op="exc_withdraw" id={e.id} label="거둬들이기" tone="danger" confirmText="이 신청을 거둬들일까요?" />}
                  </td>
                </tr>
              ))}
              {!leaves?.length && !exceptions?.length && (
                <tr><td colSpan={6} className="py-4 text-center text-ink-soft">신청 내역이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{Number(ym.slice(0, 4))}년 {Number(ym.slice(5))}월 내 근태 <span className="ml-2 text-sm font-normal text-ink-soft">지각 {lateCount} · 조퇴 {earlyCount}</span></h2>
          <div className="flex gap-1">
            <Link href={`/attendance?m=${shift(ym, -1)}`} className="btn btn-ghost !px-3 !py-1.5 text-xs">← 이전 달</Link>
            <Link href={`/attendance?m=${shift(ym, 1)}`} className="btn btn-ghost !px-3 !py-1.5 text-xs">다음 달 →</Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-ink-soft">
              <tr><th className="py-1">날짜</th><th>출근</th><th>퇴근</th><th>상태</th><th>메모</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)]">
              {(records ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="py-2 tabular-nums">{r.work_date.slice(5)} ({WEEKDAY[weekdayIndex(r.work_date)]})</td>
                  <td className="tabular-nums">{kstTime(r.clock_in) || "—"}</td>
                  <td className="tabular-nums">{kstTime(r.clock_out) || "—"}</td>
                  <td>
                    {ATT_STATUS[r.attendance_status]}
                    {r.is_late && <span className="chip chip-warn ml-1">지각</span>}
                    {r.is_early_leave && <span className="chip chip-warn ml-1">조퇴</span>}
                  </td>
                  <td className="text-xs text-ink-soft">{r.note}</td>
                  <td className="text-right">
                    {r.clock_in && (pendingCorr.has(r.id)
                      ? <span className="chip chip-info">수정 요청 중</span>
                      : <CorrectionForm action={requestCorrection} id={r.id} workDate={r.work_date} clockIn={kstTime(r.clock_in)} clockOut={kstTime(r.clock_out)} />)}
                  </td>
                </tr>
              ))}
              {!records?.length && <tr><td colSpan={6} className="py-4 text-center text-ink-soft">기록이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
