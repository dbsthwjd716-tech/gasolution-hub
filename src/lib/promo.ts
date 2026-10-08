// 주간 일소진 상승 프로모션 계산
//   일소진액 = 그 주(월~일) 광고비 합계 ÷ 집계된 날 수 (주가 끝나기 전에는 들어온 날까지만)
//   목표 일소진액 = 직전 주 일소진액 + 상승 목표. 개인·팀 따로 판정

export type DayRow = { d: string; m: string; v: number };
export type PromoSpend = { naver_through: string | null; meta_through: string | null; naver: DayRow[]; meta: DayRow[] };
export type PromoTarget = { staff_id: string; name: string; increment: number; scope: "naver" | "naver_meta"; in_team: boolean };
export type Range = { start: string; end: string };

export type PersonResult = {
  staff_id: string;
  name: string;
  scope: PromoTarget["scope"];
  increment: number;
  base: number;
  target: number;
  current: number;
  days: number; // 이번 주 집계된 날 수 (7이면 마감 가능)
  rise: number;
  gap: number; // 마감 일소진 − 목표
  rate: number | null; // 실제 상승 ÷ 상승 목표 × 100
  achieved: boolean;
  in_team: boolean;
};
export type TeamResult = Omit<PersonResult, "staff_id" | "name" | "scope" | "in_team"> & { members: string[] };

const addDays = (d: string, k: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + k);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

// 월요일 기준 한 주
export function mondayOf(d: string) {
  const t = new Date(`${d}T00:00:00Z`);
  const wd = (t.getUTCDay() + 6) % 7;
  return addDays(d, -wd);
}
export function weekOf(monday: string): Range {
  return { start: monday, end: addDays(monday, 6) };
}
export function previousWeek(r: Range): Range {
  return { start: addDays(r.start, -7), end: addDays(r.start, -1) };
}

// 그 기간 일평균 (데이터가 들어온 날까지만). 대상 범위에 따라 네이버만 / 네이버+메타
function average(data: PromoSpend, name: string, scope: PromoTarget["scope"], r: Range) {
  const through = scope === "naver_meta"
    ? [data.naver_through, data.meta_through].filter(Boolean).sort()[0] ?? null
    : data.naver_through;
  const end = through && through < r.end ? through : r.end;
  const days = end < r.start ? 0 : daysBetween(r.start, end);
  if (!days) return { avg: 0, days: 0 };
  const inRange = (x: DayRow) => x.m === name && x.d >= r.start && x.d <= end;
  let sum = data.naver.filter(inRange).reduce((t, x) => t + Number(x.v), 0);
  if (scope === "naver_meta") sum += data.meta.filter(inRange).reduce((t, x) => t + Number(x.v), 0);
  return { avg: Math.round(sum / days), days };
}

export function computePromo(data: PromoSpend, targets: PromoTarget[], base: Range, week: Range, teamIncrement: number) {
  const fullDays = daysBetween(week.start, week.end);
  const people: PersonResult[] = targets.map((t) => {
    const b = average(data, t.name, t.scope, base);
    const c = average(data, t.name, t.scope, week);
    const target = b.avg + t.increment;
    return {
      staff_id: t.staff_id, name: t.name, scope: t.scope, increment: t.increment, in_team: t.in_team,
      base: b.avg, target, current: c.avg, days: c.days,
      rise: c.avg - b.avg, gap: c.avg - target,
      rate: t.increment > 0 ? Math.round(((c.avg - b.avg) / t.increment) * 1000) / 10 : null,
      achieved: c.days > 0 && c.avg >= target,
    };
  });
  const members = people.filter((p) => p.in_team);
  const tb = members.reduce((s, p) => s + p.base, 0);
  const tc = members.reduce((s, p) => s + p.current, 0);
  const team: TeamResult = {
    members: members.map((p) => p.name),
    increment: teamIncrement, base: tb, target: tb + teamIncrement, current: tc,
    days: Math.min(...members.map((p) => p.days), fullDays),
    rise: tc - tb, gap: tc - (tb + teamIncrement),
    rate: teamIncrement > 0 ? Math.round(((tc - tb) / teamIncrement) * 1000) / 10 : null,
    achieved: members.length > 0 && members.every((p) => p.days > 0) && tc >= tb + teamIncrement,
  };
  return { people, team, fullDays, complete: people.length > 0 && people.every((p) => p.days >= fullDays) };
}

const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

// 팀 공지용 문구 (팀장·대표 개인 실적은 넣지 않음 — 목표 대상만)
export function noticeText(r: ReturnType<typeof computePromo>, base: Range, week: Range, rewardPersonal: string, rewardTeam: string) {
  const lines = [
    "[주간 일소진 상승 프로모션 결과]",
    `기준 주: ${md(base.start)}~${md(base.end)}`,
    `평가 주: ${md(week.start)}~${md(week.end)}${r.complete ? "" : ` (진행 중 · ${Math.min(...r.people.map((p) => p.days))}일치 반영)`}`,
    "",
  ];
  for (const p of r.people) {
    lines.push(
      `▶ ${p.name}`,
      `기준 일소진액: ${won(p.base)}`,
      `상승 목표: +${won(p.increment)}`,
      `목표 일소진액: ${won(p.target)}`,
      `${r.complete ? "마감" : "현재"} 일소진액: ${won(p.current)}`,
      `결과: ${p.achieved ? "달성" : "미달성"}${r.complete ? "" : " (진행 중)"}`,
      "",
    );
  }
  lines.push(
    "▶ 팀",
    `기준 일소진액: ${won(r.team.base)}`,
    `상승 목표: +${won(r.team.increment)}`,
    `목표 일소진액: ${won(r.team.target)}`,
    `${r.complete ? "마감" : "현재"} 일소진액: ${won(r.team.current)}`,
    `결과: ${r.team.achieved ? "달성" : "미달성"}${r.complete ? "" : " (진행 중)"}`,
    "",
    `🎁 개인 달성: ${rewardPersonal} / 팀 달성: ${rewardTeam}`,
    "※ 네이버 유상실적(VAT 별도) 기준, 진원 인계건 제외, 바이럴 공통 제외.",
  );
  return lines.join("\n");
}
