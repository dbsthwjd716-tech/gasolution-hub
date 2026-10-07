import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { CANCEL_STATUS, EXCEPTION_TYPE, LEAVE_STATUS, LEAVE_TYPE, days, kstTime } from "@/lib/attendance";
import { act } from "../actions";
import { ActButton } from "../forms";

// 대표·팀장 결재함: 휴가(1차 → 최종), 휴가 취소, 근태 예외, 근태 수정 요청
export default async function Approvals() {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">대표·팀장만 볼 수 있습니다.</p>;
  const today = todayKST();
  const [{ data: staff }, { data: leaves }, { data: cancels }, { data: exc }, { data: upcoming }, { data: corr }] = await Promise.all([
    supabase.from("staff").select("id,name"),
    supabase.from("leave_requests").select("*").in("status", ["pending", "first_approved"]).order("start_date"),
    supabase.from("leave_requests").select("*").eq("status", "approved").not("cancel_status", "is", null).order("start_date"),
    supabase.from("attendance_exceptions").select("*").eq("status", "pending").order("work_date"),
    supabase.from("attendance_exceptions").select("*").eq("status", "approved").gte("work_date", today).order("work_date").limit(30),
    supabase.from("attendance_correction_requests").select("*, record:attendance_records(clock_in,clock_out)").eq("status", "pending").order("work_date"),
  ]);
  const name = new Map((staff ?? []).map((s) => [s.id, s.name] as const));
  const empty = !leaves?.length && !cancels?.length && !exc?.length && !corr?.length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">근태 결재</h1>
        <p className="text-sm text-ink-soft">휴가는 1차 승인 → 최종 승인 두 단계입니다. 최종 승인되면 근태와 연차 사용에 반영됩니다.</p>
      </header>
      {empty && <p className="glass p-5 text-sm text-ink-soft">기다리는 결재가 없습니다.</p>}

      {!!leaves?.length && (
        <section className="glass space-y-2 p-5">
          <h2 className="font-bold">휴가 신청 {leaves.length}건</h2>
          <ul className="divide-y divide-[var(--glass-border)] text-sm">
            {leaves.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p><b>{name.get(l.staff_id)}</b> · {LEAVE_TYPE[l.leave_type]} · <span className="tabular-nums">{l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ""}</span> · {days(l.leave_days)}
                    <span className={`chip ${LEAVE_STATUS[l.status].chip} ml-2`}>{LEAVE_STATUS[l.status].label}</span>
                  </p>
                  {l.reason && <p className="whitespace-pre-line text-xs text-ink-soft">{l.reason}</p>}
                  {l.first_approved_by && <p className="text-xs text-ink-soft">1차 승인: {name.get(l.first_approved_by)}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ActButton action={act} op={l.status === "pending" ? "leave_first" : "leave_final"} id={l.id} tone="main"
                    label={l.status === "pending" ? "1차 승인" : "최종 승인"}
                    confirmText={l.status === "pending" ? "1차 승인할까요?" : "최종 승인할까요? 근태와 연차 사용에 바로 반영됩니다."}>
                    {l.leave_type === "reward" && (
                      <select name="deduct" defaultValue={l.deduct_leave ? "yes" : "no"} className="field !w-auto !py-1 text-xs" aria-label="연차 차감">
                        <option value="no">연차 차감 안 함</option>
                        <option value="yes">연차에서 차감</option>
                      </select>
                    )}
                  </ActButton>
                  <ActButton action={act} op="leave_reject" id={l.id} label="반려" tone="danger" confirmText="이 휴가 신청을 반려할까요?">
                    <input name="note" placeholder="반려 사유 (선택)" className="field !w-32 !py-1 text-xs" aria-label="반려 사유" />
                  </ActButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!cancels?.length && (
        <section className="glass space-y-2 p-5">
          <h2 className="font-bold">휴가 취소 요청 {cancels.length}건</h2>
          <ul className="divide-y divide-[var(--glass-border)] text-sm">
            {cancels.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p><b>{name.get(l.staff_id)}</b> · {LEAVE_TYPE[l.leave_type]} · <span className="tabular-nums">{l.start_date}{l.end_date !== l.start_date ? ` ~ ${l.end_date}` : ""}</span>
                    <span className="chip chip-warn ml-2">{CANCEL_STATUS[l.cancel_status]}</span></p>
                  <p className="text-xs text-ink-soft">취소 사유: {l.cancel_reason}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ActButton action={act} op={l.cancel_status === "pending" ? "cancel_first" : "cancel_final"} id={l.id} tone="main"
                    label={l.cancel_status === "pending" ? "취소 1차 승인" : "취소 최종 승인"}
                    confirmText={l.cancel_status === "pending" ? "취소 요청을 1차 승인할까요?" : "휴가를 취소할까요? 연차가 돌아오고 그날 휴가 근태가 지워집니다."} />
                  <ActButton action={act} op="cancel_reject" id={l.id} label="취소 반려" tone="danger" confirmText="취소 요청을 반려할까요? 휴가는 그대로 유지됩니다." />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!exc?.length && (
        <section className="glass space-y-2 p-5">
          <h2 className="font-bold">기타 근태 · 미팅 · 조기퇴근 {exc.length}건</h2>
          <ul className="divide-y divide-[var(--glass-border)] text-sm">
            {exc.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p><b>{name.get(e.staff_id)}</b> · {EXCEPTION_TYPE[e.exception_type]} · <span className="tabular-nums">{e.work_date}</span>
                    <span className="ml-1 text-xs text-ink-soft tabular-nums">
                      {e.approved_leave_time ? `${e.approved_leave_time.slice(0, 5)} 퇴근` : e.start_time ? `${e.start_time.slice(0, 5)}${e.end_time ? ` ~ ${e.end_time.slice(0, 5)}` : ""}` : "종일"}
                    </span>
                  </p>
                  <p className="text-xs text-ink-soft">{[e.location, e.note].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex gap-2">
                  <ActButton action={act} op="exc_approve" id={e.id} label="승인" tone="main" />
                  <ActButton action={act} op="exc_reject" id={e.id} label="반려" tone="danger" confirmText="반려할까요?" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!corr?.length && (
        <section className="glass space-y-2 p-5">
          <h2 className="font-bold">근태 수정 요청 {corr.length}건</h2>
          <ul className="divide-y divide-[var(--glass-border)] text-sm">
            {corr.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p><b>{name.get(c.staff_id)}</b> · <span className="tabular-nums">{c.work_date}</span> ·
                    <span className="tabular-nums"> {kstTime(c.record?.clock_in) || "—"}~{kstTime(c.record?.clock_out) || "—"} → <b>{kstTime(c.requested_clock_in) || "—"}~{kstTime(c.requested_clock_out) || "—"}</b></span></p>
                  <p className="text-xs text-ink-soft">사유: {c.reason}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ActButton action={act} op="corr_approve" id={c.id} label="승인" tone="main" />
                  <ActButton action={act} op="corr_reject" id={c.id} label="반려" tone="danger" confirmText="반려할까요?">
                    <input name="note" placeholder="반려 사유 (선택)" className="field !w-32 !py-1 text-xs" aria-label="반려 사유" />
                  </ActButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!upcoming?.length && (
        <section className="glass space-y-2 p-5">
          <h2 className="font-bold">승인된 예정 근태 예외</h2>
          <ul className="divide-y divide-[var(--glass-border)] text-sm">
            {upcoming.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <p><b>{name.get(e.staff_id)}</b> · {EXCEPTION_TYPE[e.exception_type]} · <span className="tabular-nums">{e.work_date}</span>
                  <span className="ml-1 text-xs text-ink-soft">{[e.location, e.note].filter(Boolean).join(" · ")}</span></p>
                <ActButton action={act} op="exc_cancel" id={e.id} label="승인 취소" tone="danger" confirmText="승인을 취소할까요?" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
