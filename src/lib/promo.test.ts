import { test } from "node:test";
import assert from "node:assert/strict";
import { computePromo, goalNotice, mondayOf, previousWeek, resultNotice, weekOf, type PromoSpend } from "./promo.ts";

const days = (from: string, n: number, m: string, v: number) =>
  Array.from({ length: n }, (_, i) => {
    const t = new Date(`${from}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + i);
    return { d: t.toISOString().slice(0, 10), m, v };
  });

test("주 계산: 월요일 시작", () => {
  assert.equal(mondayOf("2026-10-08"), "2026-10-05");
  assert.deepEqual(previousWeek(weekOf("2026-10-05")), { start: "2026-09-28", end: "2026-10-04" });
});

test("개인·팀 판정: 직전 주 일평균 + 목표", () => {
  const data: PromoSpend = {
    naver_through: "2026-10-11",
    meta_through: "2026-10-11",
    naver: [...days("2026-09-28", 7, "서진원", 1000000), ...days("2026-10-05", 7, "서진원", 1070000), ...days("2026-09-28", 14, "박규진", 500000)],
    meta: [...days("2026-10-05", 7, "박규진", 10000), ...days("2026-10-05", 7, "서진원", 999999)],
  };
  const base = { start: "2026-09-28", end: "2026-10-04" };
  const week = { start: "2026-10-05", end: "2026-10-11" };
  const r = computePromo(data, [
    { staff_id: "a", name: "서진원", increment: 60000, scope: "naver", in_team: true },
    { staff_id: "b", name: "박규진", increment: 30000, scope: "naver_meta", in_team: true },
  ], base, week, 90000);
  const [jin, gyu] = r.people;
  assert.equal(jin.base, 1000000);
  assert.equal(jin.current, 1070000); // 메타는 넣지 않음
  assert.equal(jin.achieved, true);
  assert.equal(jin.rate, 116.7);
  assert.equal(gyu.current, 510000);
  assert.equal(gyu.achieved, false);
  assert.equal(r.team.current - r.team.base, 80000);
  assert.equal(r.team.achieved, false);
  assert.equal(r.complete, true);
  const goal = goalNotice(r, week);
  assert.match(goal, /- 진원 : \+60,000원 \(1,060,000원\)/);
  assert.match(goal, /- 팀 전체 : \+90,000원 \(1,590,000원\)/);
  const res = resultNotice(r, "2026-10-11", 1, 2);
  assert.match(res, /\[조기퇴근 프로모션 결과 \(10\/11 기준\)\]/);
  assert.match(res, /✅  서진원 : 목표 달성 \(\+10,000원\) → 1시간 조기퇴근/);
  assert.match(res, /❌  박규진 : 목표 미달 \(-20,000원\)/);
  assert.match(res, /🏆 서진원 : 1시간 조기퇴근/);
  // 팀까지 달성하면 개인 달성자는 총 3시간, 나머지는 2시간
  const r2 = computePromo(data, [
    { staff_id: "a", name: "서진원", increment: 60000, scope: "naver", in_team: true },
    { staff_id: "b", name: "박규진", increment: 30000, scope: "naver_meta", in_team: true },
  ], base, week, 50000);
  const res2 = resultNotice(r2, "2026-10-11", 1, 2);
  assert.match(res2, /→ 전원 금요일 2시간 조기퇴근/);
  assert.match(res2, /🏆 서진원 : 총 3시간 조기퇴근\n🏆 박규진 : 2시간 조기퇴근/);
});

test("주 중간: 들어온 날까지만 평균", () => {
  const data: PromoSpend = { naver_through: "2026-10-07", meta_through: "2026-10-08", naver: days("2026-10-05", 3, "서진원", 300), meta: [] };
  const r = computePromo(data, [{ staff_id: "a", name: "서진원", increment: 0, scope: "naver", in_team: true }], { start: "2026-09-28", end: "2026-10-04" }, { start: "2026-10-05", end: "2026-10-11" }, 0);
  assert.equal(r.people[0].days, 3);
  assert.equal(r.people[0].current, 300);
  assert.equal(r.complete, false);
});
