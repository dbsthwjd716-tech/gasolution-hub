import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { ConfirmSubmit } from "../../billing/panel";
import { addHoliday, importLegacyAttendance, removeHoliday, saveHr, saveSettings } from "../actions";
import { HolidayForm, HrForm, ImportForm, SettingsForm, type HrRow } from "../forms";

// 대표·팀장: 근무시간 설정, 휴일, 직원 인사 정보(입사일·생일·근무 유형), 예전 대시보드 기록 가져오기
export default async function AttendanceSettings() {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">대표·팀장만 볼 수 있습니다.</p>;
  const year = Number(todayKST().slice(0, 4));
  const [{ data: settings }, { data: holidays }, { data: staff }, { data: hr }, { data: hist }] = await Promise.all([
    supabase.from("work_settings").select("setting_key,setting_label,setting_value"),
    supabase.from("company_holidays").select("*").gte("holiday_date", `${year}-01-01`).order("holiday_date"),
    supabase.from("staff").select("id,name").eq("is_active", true).order("name"),
    supabase.from("staff_hr").select("*"),
    supabase.from("work_setting_history").select("*").order("created_at", { ascending: false }).limit(10),
  ]);
  const order = ["standard_clock_in", "standard_clock_out", "lunch_start", "lunch_end", "payday_lunch_end", "morning_half_clock_in", "morning_half_clock_out",
    "afternoon_half_clock_in", "afternoon_half_clock_out", "flexible_clock_in_start", "flexible_clock_in_end", "flexible_work_minutes"];
  const sorted = [...(settings ?? [])].sort((a, b) => order.indexOf(a.setting_key) - order.indexOf(b.setting_key));
  const hrMap = new Map((hr ?? []).map((h) => [h.staff_id, h]));
  const rows: HrRow[] = (staff ?? []).map((s) => {
    const h = hrMap.get(s.id);
    return {
      staff_id: s.id, name: s.name, join_date: h?.join_date ?? null, birthday_month: h?.birthday_month ?? null, birthday_day: h?.birthday_day ?? null,
      work_type: h?.work_type ?? "standard", leave_grant_mode: h?.leave_grant_mode ?? "accounting_auto", work_phone: h?.work_phone ?? null,
    };
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">근태 설정</h1>
        <p className="text-sm text-ink-soft">대표·팀장만 볼 수 있습니다. 바꾼 내용은 이력에 남습니다.</p>
      </header>

      <section className="glass space-y-3 p-5">
        <h2 className="font-bold">근무시간</h2>
        <p className="text-xs text-ink-soft">시간은 HH:MM (예: 10:00). 지각은 출근 기준 시각 이후, 조퇴는 퇴근 기준 시각 이전. 시차근무는 출근 가능 종료 시각 이후면 지각, 출근 후 근무시간(분)을 채우기 전 퇴근이면 조퇴.</p>
        <SettingsForm action={saveSettings} settings={sorted} />
        {!!hist?.length && (
          <details className="text-xs text-ink-soft">
            <summary className="cursor-pointer">최근 변경 이력</summary>
            <ul className="mt-1 space-y-0.5">
              {hist.map((h) => <li key={h.id}>{h.created_at.slice(0, 10)} · {h.setting_label}: {h.old_value} → {h.new_value}</li>)}
            </ul>
          </details>
        )}
      </section>

      <section className="glass space-y-3 p-5">
        <h2 className="font-bold">직원 인사 정보</h2>
        <p className="text-xs text-ink-soft">생일은 생일 조기퇴근, 입사일·부여 방식은 연차 자동 부여(1년 미만은 매달 1일 월차, 회계연도는 매년 1월 1일 15일)에 쓰입니다. 본인과 대표·팀장만 볼 수 있습니다.</p>
        <div className="space-y-3 divide-y divide-[var(--glass-border)]">
          {rows.map((r) => <div key={r.staff_id} className="pt-3 first:pt-0"><HrForm action={saveHr} row={r} /></div>)}
        </div>
      </section>

      <section className="glass space-y-3 p-5">
        <h2 className="font-bold">휴일 ({year}년~)</h2>
        <p className="text-xs text-ink-soft">휴일에는 출근 버튼이 막히고, 연차 일수 계산에서 빠집니다. 공휴일은 예전 대시보드에서 가져온 2027년까지 들어 있습니다.</p>
        <HolidayForm action={addHoliday} />
        <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {(holidays ?? []).map((h) => (
            <li key={h.holiday_date} className="flex items-center justify-between gap-2 rounded-lg bg-white/60 px-3 py-1.5">
              <span><span className="tabular-nums">{h.holiday_date}</span> {h.holiday_name}</span>
              <ConfirmSubmit action={removeHoliday.bind(null, h.holiday_date)} label="빼기" confirmText={`${h.holiday_date} ${h.holiday_name}을(를) 휴일에서 뺄까요?`} />
            </li>
          ))}
        </ul>
      </section>

      <section className="glass space-y-3 p-5">
        <h2 className="font-bold">예전 대시보드 근태 가져오기</h2>
        <p className="text-xs text-ink-soft">
          예전 대시보드의 출퇴근 기록·휴가 신청·근태 예외·연차·공휴일·근무 설정·직원 인사 정보를 가져옵니다. 여러 번 눌러도 중복되지 않고,
          예전 대시보드에서 바뀐 결재 상태는 최신으로 맞춰집니다. 직원들이 통합 시스템으로 옮겨 오기 전까지 필요할 때 다시 눌러 주세요.
        </p>
        <ImportForm action={importLegacyAttendance} />
      </section>
    </div>
  );
}
