import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { calendarCells, isYm, kstTime, monthDays, WEEKDAY } from "@/lib/attendance";

function shift(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Ev = { event_date: string; staff_id: string | null; staff_name: string | null; source: string; event_type: string; label: string; clock_in: string | null; clock_out: string | null; is_late: boolean; is_early_leave: boolean };

const TONE: Record<string, string> = {
  holiday: "bg-[var(--danger-soft,#fde8e8)] text-danger",
  leave: "bg-brand-soft text-brand",
  exception: "bg-[var(--warn-bg)] text-[var(--warn-ink)]",
  attendance: "bg-[#eef1f6] text-ink-soft",
};

// 모두가 보는 근태 달력: 승인된 휴가·공휴일·근태 예외 (대표·팀장은 출퇴근 기록까지)
export default async function AttendanceCalendar(props: PageProps<"/attendance/calendar">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!me) return null;
  const today = todayKST();
  const ym = isYm(typeof sp.m === "string" ? sp.m : null) ? (sp.m as string) : today.slice(0, 7);
  const { start, end } = monthDays(ym);
  const { data, error } = await supabase.rpc("att_calendar", { p_start: start, p_end: end });
  const events = (data ?? []) as Ev[];
  const byDay = new Map<string, Ev[]>();
  for (const e of events) byDay.set(e.event_date, [...(byDay.get(e.event_date) ?? []), e]);
  const manager = me.role !== "staff";

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{Number(ym.slice(0, 4))}년 {Number(ym.slice(5))}월 근태 달력</h1>
          <p className="text-sm text-ink-soft">승인된 휴가·근태 예외와 휴일{manager ? ", 출퇴근 기록(대표·팀장만)" : ""}</p>
        </div>
        <div className="flex gap-1">
          <Link href={`/attendance/calendar?m=${shift(ym, -1)}`} className="btn btn-ghost">← 이전 달</Link>
          <Link href="/attendance/calendar" className="btn btn-ghost">이번 달</Link>
          <Link href={`/attendance/calendar?m=${shift(ym, 1)}`} className="btn btn-ghost">다음 달 →</Link>
        </div>
      </header>
      {error && <p className="glass p-3 text-sm text-danger">{error.message}</p>}
      <div className="glass overflow-x-auto p-3">
        <div className="grid min-w-[760px] grid-cols-7 gap-1">
          {WEEKDAY.map((w, i) => (
            <p key={w} className={`py-1 text-center text-xs font-bold ${i >= 5 ? "text-danger" : "text-ink-soft"}`}>{w}</p>
          ))}
          {calendarCells(ym).map((d, i) => {
            if (!d) return <div key={`x${i}`} />;
            const list = byDay.get(d) ?? [];
            const holiday = list.some((e) => e.source === "holiday") || i % 7 >= 5;
            return (
              <div key={d} className={`min-h-24 rounded-lg border p-1.5 ${d === today ? "border-brand" : "border-[var(--glass-border)]"} ${holiday ? "bg-white/40" : "bg-white/70"}`}>
                <p className={`text-xs font-bold ${holiday ? "text-danger" : ""}`}>{Number(d.slice(8))}</p>
                <ul className="mt-1 space-y-0.5">
                  {list
                    .sort((a, b) => ["holiday", "leave", "exception", "attendance"].indexOf(a.source) - ["holiday", "leave", "exception", "attendance"].indexOf(b.source))
                    .map((e, k) => (
                      <li key={k} className={`truncate rounded px-1 text-[11px] leading-5 ${TONE[e.source]}`}
                        title={e.source === "attendance" ? `${e.staff_name} ${kstTime(e.clock_in)}~${kstTime(e.clock_out)}` : `${e.staff_name ?? ""} ${e.label}`}>
                        {e.source === "holiday" ? e.label
                          : e.source === "attendance"
                            ? `${e.staff_name} ${kstTime(e.clock_in)}${e.clock_out ? `~${kstTime(e.clock_out)}` : ""}${e.is_late ? " 지각" : ""}${e.is_early_leave ? " 조퇴" : ""}`
                            : `${e.staff_name} ${e.label}`}
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
