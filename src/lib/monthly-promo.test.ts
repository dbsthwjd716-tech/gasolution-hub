import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, autoTargets, computeMonth, goalNotice, resultNotice, shiftMonth, type PromoMember, type PromoMonth } from "./monthly-promo.ts";

const m = (name: string, actual: number | null, target: number | null = null, extra: Partial<PromoMember> = {}): PromoMember => ({
  name, actual, target, inTeam: true, teamAmount: null, leader: false, excluded: false, note: "", ...extra,
});
// 예전 체커에 있던 실제 흐름과 같은 모양의 예시 숫자
const months: Record<string, PromoMonth> = {
  "2026-07": { month: "2026-07", teamTarget: null, closed: true, memo: "", members: [m("가", 180_000_000), m("팀장", 100_000_000, null, { leader: true, inTeam: false })] },
  "2026-08": { month: "2026-08", teamTarget: null, closed: true, memo: "", members: [m("가", 191_000_000), m("나", 30_000_000)] },
  "2026-09": {
    month: "2026-09", teamTarget: 240_000_000, closed: true, memo: "",
    members: [m("가", 217_000_000, 200_000_000, { teamAmount: 178_000_000 }), m("나", 50_600_000, 45_000_000), m("다", 6_000_000, 10_000_000), m("팀장", 41_234_567, 140_000_000, { leader: true, inTeam: false })],
  },
};

test("달 이동", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("팀 목표: 팀 산정액이 있으면 그 값, 팀장 제외, 미달이면 팀 인센티브 없음", () => {
  const c = computeMonth(months, "2026-09", DEFAULT_CONFIG)!;
  assert.equal(c.team.actual, 178_000_000 + 50_600_000 + 6_000_000);
  assert.equal(c.team.status, "bad");
  assert.ok(c.rows.every((r) => r.teamAmt === 0));
});

test("기존 상승분 유지와 신규 상승 후보", () => {
  const c = computeMonth(months, "2026-09", DEFAULT_CONFIG)!;
  const ga = c.rows.find((r) => r.name === "가")!;
  assert.equal(ga.prevBands, 2); // 7→8월 1,100만 상승 = 2구간
  assert.equal(ga.keep, "ok"); // 9월이 8월 이상
  assert.equal(ga.keepAmt, 100_000);
  assert.equal(ga.newBands, 5); // 8→9월 2,600만 상승
  assert.equal(ga.pay, 100_000);
  const na = c.rows.find((r) => r.name === "나")!;
  assert.equal(na.keep, "na"); // 7월 기록 없음
  assert.equal(na.goal, "ok");
});

test("팀 목표 달성이면 지급 제외 인원만 0원", () => {
  const ms = { ...months, "2026-09": { ...months["2026-09"], teamTarget: 200_000_000, members: months["2026-09"].members.map((x) => (x.name === "다" ? { ...x, excluded: true } : x)) } };
  const c = computeMonth(ms, "2026-09", DEFAULT_CONFIG)!;
  assert.equal(c.team.status, "ok");
  assert.equal(c.rows.find((r) => r.name === "나")!.pay, 100_000);
  assert.equal(c.rows.find((r) => r.name === "다")!.pay, 0);
});

test("부분 유지 인정", () => {
  const ms = { ...months, "2026-09": { ...months["2026-09"], members: [m("가", 186_000_000)] } };
  assert.equal(computeMonth(ms, "2026-09", DEFAULT_CONFIG)!.rows[0].keep, "bad");
  const p = computeMonth(ms, "2026-09", { ...DEFAULT_CONFIG, partial: true })!.rows[0];
  assert.equal(p.keep, "part");
  assert.equal(p.keptBands, 1);
});

test("마감 전 달은 판정하지 않고 진행 중", () => {
  const ms = { ...months, "2026-10": { month: "2026-10", teamTarget: 240_000_000, closed: false, memo: "", members: [m("가", null, 222_000_000)] } };
  const c = computeMonth(ms, "2026-10", DEFAULT_CONFIG)!;
  assert.equal(c.team.status, "wait");
  assert.equal(c.rows[0].keep, "wait");
  assert.equal(c.rows[0].keepPot, 250_000);
});

test("자동 목표: 달성은 마감+500만 백만원 절삭, 미달은 유지", () => {
  const a = autoTargets(months, "2026-10", DEFAULT_CONFIG);
  assert.equal(a.members["가"].target, 222_000_000);
  assert.equal(a.members["나"].target, 55_000_000);
  assert.deepEqual(a.members["다"], { target: 10_000_000, kind: "carry" });
  assert.equal(autoTargets(months, "2026-12", DEFAULT_CONFIG).ready, false);
});

test("공지에는 팀장 실적이 없음", () => {
  const c = computeMonth(months, "2026-09", DEFAULT_CONFIG)!;
  for (const t of [goalNotice(c), resultNotice(c, DEFAULT_CONFIG)]) {
    assert.ok(!t.includes("팀장"));
    assert.ok(!t.includes("41,234,567"));
  }
  assert.ok(resultNotice(c, DEFAULT_CONFIG).includes("최종 미달성"));
});
