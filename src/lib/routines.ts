// 루틴·약속이 '해야 하는 날' 계산
//   daily  = 평일(월~금) 매일. 지난날 못 한 건 넘기지 않음 (오늘 것만)
//   weekly = 고른 요일 (1=월 … 7=일), monthly = 고른 날짜 (그 달에 없으면 말일), once = 약속 날짜
//   매주·매월·약속은 못 하고 지나가면 완료할 때까지 계속 보임 (가장 최근 1회)

export type Routine = {
  id: string;
  kind: "daily" | "weekly" | "monthly" | "once";
  weekdays: number[];
  month_day: number | null;
  due_date: string | null;
  start_date: string;
  is_active: boolean;
};

const addDays = (d: string, k: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + k);
  return t.toISOString().slice(0, 10);
};
export const isoWeekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // 1=월
const lastDayOfMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export function isDue(r: Routine, d: string) {
  if (!r.is_active || d < r.start_date) return false;
  if (r.kind === "once") return r.due_date === d;
  if (r.kind === "daily") return isoWeekday(d) <= 5;
  if (r.kind === "weekly") return r.weekdays.includes(isoWeekday(d));
  const want = Math.min(r.month_day ?? 1, lastDayOfMonth(d));
  return Number(d.slice(8)) === want;
}

// 오늘 할 일: 오늘 해야 하는 것 + (매일 제외) 최근에 못 하고 지나간 것 1회. 이미 완료한 날짜는 뺌
export function dueToday(r: Routine, today: string, done: Set<string>, lookback = 45): { date: string; late: number } | null {
  if (r.kind === "daily") return isDue(r, today) && !done.has(today) ? { date: today, late: 0 } : null;
  if (r.kind === "once") {
    if (!r.is_active || !r.due_date || r.due_date > today || done.has(r.due_date)) return null;
    return { date: r.due_date, late: daysBetween(r.due_date, today) };
  }
  for (let k = 0; k <= lookback; k++) {
    const d = addDays(today, -k);
    if (isDue(r, d)) return done.has(d) ? null : { date: d, late: k };
  }
  return null;
}

// 앞으로 n일 안에 해야 하는 날 (다가오는 일정 보기)
export function upcoming(r: Routine, today: string, days = 7) {
  const out: string[] = [];
  for (let k = 1; k <= days; k++) {
    const d = addDays(today, k);
    if (isDue(r, d)) out.push(d);
  }
  return out;
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const WD = ["", "월", "화", "수", "목", "금", "토", "일"];
export function cycleLabel(r: Routine & { due_time?: string | null }) {
  const t = r.due_time ? ` ${r.due_time.slice(0, 5)}` : "";
  if (r.kind === "daily") return `평일 매일${t}`;
  if (r.kind === "weekly") return `매주 ${[...r.weekdays].sort().map((w) => WD[w]).join("·")}${t}`;
  if (r.kind === "monthly") return `매월 ${r.month_day === 31 ? "말일" : `${r.month_day}일`}${t}`;
  return `약속 ${r.due_date}${t}`;
}
