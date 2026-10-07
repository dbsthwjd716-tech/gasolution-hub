// 근태·연차 화면에서 쓰는 이름표와 날짜 계산 (한국 시간 기준)

export const LEAVE_TYPE: Record<string, string> = {
  annual: "연차",
  morning_half: "오전반차",
  afternoon_half: "오후반차",
  family_event: "경조휴가",
  reward: "포상휴가",
};

export const LEAVE_STATUS: Record<string, { label: string; chip: string }> = {
  pending: { label: "1차 승인 대기", chip: "chip-warn" },
  first_approved: { label: "최종 승인 대기", chip: "chip-info" },
  approved: { label: "승인", chip: "chip-ok" },
  rejected: { label: "반려", chip: "chip-muted" },
  cancelled: { label: "취소", chip: "chip-muted" },
};

export const CANCEL_STATUS: Record<string, string> = {
  pending: "취소 요청 · 1차 대기",
  first_approved: "취소 요청 · 최종 대기",
};

export const EXCEPTION_TYPE: Record<string, string> = {
  other: "기타 근태",
  meeting: "미팅",
  direct_home: "미팅 후 직퇴",
  birthday_early_leave: "생일 조기퇴근",
  promotion_early_leave: "프로모션 조기퇴근",
};

export const EXCEPTION_STATUS: Record<string, { label: string; chip: string }> = {
  pending: { label: "승인 대기", chip: "chip-warn" },
  approved: { label: "승인", chip: "chip-ok" },
  rejected: { label: "반려", chip: "chip-muted" },
  cancelled: { label: "취소", chip: "chip-muted" },
};

export const ATT_STATUS: Record<string, string> = {
  normal: "정상",
  late: "지각",
  early_leave: "조퇴",
  annual_leave: "연차",
  morning_half: "오전반차",
  afternoon_half: "오후반차",
  family_event: "경조휴가",
  reward_leave: "포상휴가",
  meeting: "미팅",
  direct_home: "미팅 후 직퇴",
  birthday_early_leave: "생일 조기퇴근",
  promotion_early_leave: "프로모션 조기퇴근",
  absent: "결근",
  other: "기타 근태",
};

export const WORK_TYPE: Record<string, string> = { standard: "기본근무", flexible: "시차근무" };
export const GRANT_MODE: Record<string, string> = {
  accounting_auto: "회계연도 (매년 1월 15일)",
  manual: "1년 미만 (매달 1일 월차)",
};

const KST = "Asia/Seoul";

// 2026-10-12T01:05:00Z → "10:05"
export function kstTime(ts: string | null | undefined): string {
  if (!ts) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: KST, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
}

// 한국 날짜 + "HH:MM" → 저장용 시각 문자열 (빈 값이면 null)
export function kstStamp(date: string, hm: string | null | undefined): string | null {
  const v = (hm ?? "").trim();
  if (!v) return null;
  if (!/^\d{1,2}:\d{2}$/.test(v)) throw new Error("시간은 HH:MM 형식으로 입력해 주세요");
  const [h, m] = v.split(":");
  return `${date}T${h.padStart(2, "0")}:${m}:00+09:00`;
}

// "2026-10" → 그달 1일·말일·날짜 목록
export function monthDays(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
  return { start: days[0], end: days[last - 1], days };
}

// 0=월 … 6=일 (날짜 문자열 기준, 시간대 영향 없음)
export function weekdayIndex(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7;
}

export const WEEKDAY = ["월", "화", "수", "목", "금", "토", "일"];

// 달력용 칸: 월요일부터 시작, 앞뒤 빈칸은 null
export function calendarCells(ym: string): (string | null)[] {
  const { days } = monthDays(ym);
  const cells: (string | null)[] = Array(weekdayIndex(days[0])).fill(null);
  cells.push(...days);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function isYm(v: string | undefined | null): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export const days = (n: number | string) => {
  const v = Number(n);
  return `${Number.isInteger(v) ? v : v.toFixed(1)}일`;
};
