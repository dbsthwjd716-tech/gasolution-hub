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
const signed = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(Math.round(v)).toLocaleString("ko-KR")}원`;
const md = (d: string) => `${String(Number(d.slice(5, 7))).padStart(2, "0")}/${d.slice(8)}`;
const hours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}시간`;

// 이름 부르기: 1차 공지는 이름만(진원), 2차는 성+이름(서진원)
export const givenName = (n: string) => (n.length >= 3 ? n.slice(1) : n);

// 1차: 목표 전달 — 괄호 안은 목표 일소진액 (기준 + 상승 목표)
export function goalNotice(r: ReturnType<typeof computePromo>, week: Range) {
  const lines = [
    "📈 [금주 조기퇴근 프로모션]",
    "",
    "■ 목표 기간",
    `${md(week.start)}~${md(week.end)} · 지난주 대비 금주 일평균 광고비 소진액 증액`,
    "",
    "■ 개인 목표",
    "",
    ...r.people.map((p) => `- ${givenName(p.name)} : +${p.increment.toLocaleString("ko-KR")}원 (${p.target.toLocaleString("ko-KR")}원)`),
    "",
    "■ 팀 목표",
    "",
    `- 팀 전체 : +${r.team.increment.toLocaleString("ko-KR")}원 (${r.team.target.toLocaleString("ko-KR")}원)`,
  ];
  return lines.join("\n");
}

// 2차: 결과 전달 — 개인 달성 시 개인 시간, 팀 달성 시 팀원 전원 팀 시간, 합쳐서 최종
export function resultNotice(
  r: ReturnType<typeof computePromo>,
  asOf: string,
  personalHours: number,
  teamHours: number,
) {
  const lines = [`[조기퇴근 프로모션 결과 (${md(asOf)} 기준)]`, "", "개인 목표", ""];
  for (const p of r.people) {
    const n = p.name;
    lines.push(p.achieved ? `✅  ${n} : 목표 달성 (${signed(p.gap)}) → ${hours(personalHours)} 조기퇴근` : `❌  ${n} : 목표 미달 (${signed(p.gap)})`);
  }
  lines.push("", "팀 목표", "");
  lines.push(`${r.team.achieved ? "✅" : "❌"}  목표 ${won(r.team.target)} → 실적 ${won(r.team.current)} (${signed(r.team.gap)})`);
  if (r.team.achieved) lines.push(`→ 전원 금요일 ${hours(teamHours)} 조기퇴근`);
  // 최종: 사람마다 받은 시간 합계, 같은 시간끼리 묶음
  const total = new Map<number, string[]>();
  for (const p of r.people) {
    const h = (p.achieved ? personalHours : 0) + (r.team.achieved && p.in_team ? teamHours : 0);
    if (h > 0) total.set(h, [...(total.get(h) ?? []), p.name]);
  }
  lines.push("", "최종", "");
  if (!total.size) lines.push("이번 주는 조기퇴근 대상이 없습니다. 다음 주에 다시 도전해요! 💪");
  for (const [h, names] of [...total.entries()].sort((a, b) => b[0] - a[0])) {
    lines.push(`🏆 ${names.join(" / ")} : ${h > Math.max(personalHours, teamHours) ? "총 " : ""}${hours(h)} 조기퇴근`);
  }
  return lines.join("\n");
}
