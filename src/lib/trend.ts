// 홈 광고비 추이: 날짜별 합계 (네이버 유상실적 + 메타, VAT 별도)
import type { PromoSpend } from "./promo";

export type Point = { d: string; v: number };

export const addDays = (d: string, k: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + k);
  return t.toISOString().slice(0, 10);
};

// 두 데이터가 모두 들어온 마지막 날 (메타가 없으면 네이버 기준)
export function trendEnd(data: PromoSpend, today: string): string | null {
  const ends = [data.naver_through, data.meta_through].filter((x): x is string => !!x).sort();
  const end = ends[0] ?? null;
  if (!end) return null;
  return end < today ? end : addDays(today, -1);
}

// 최근 days일과 바로 앞 days일. names가 있으면 그 담당자만
export function dailySeries(data: PromoSpend, end: string, days: number, names: string[] | null) {
  const sum = new Map<string, number>();
  for (const x of [...data.naver, ...data.meta]) {
    if (names && !names.includes(x.m)) continue;
    sum.set(x.d, (sum.get(x.d) ?? 0) + Number(x.v || 0));
  }
  const build = (last: string): Point[] =>
    Array.from({ length: days }, (_, i) => {
      const d = addDays(last, i - days + 1);
      return { d, v: Math.round(sum.get(d) ?? 0) };
    });
  const cur = build(end);
  const prev = build(addDays(end, -days));
  const total = (p: Point[]) => p.reduce((t, x) => t + x.v, 0);
  return { cur, prev, curTotal: total(cur), prevTotal: total(prev) };
}
