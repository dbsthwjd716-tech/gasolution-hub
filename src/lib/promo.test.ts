import { test } from "node:test";
import assert from "node:assert/strict";
import { computePromo, mondayOf, noticeText, previousWeek, weekOf, type PromoSpend } from "./promo.ts";

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
  assert.match(noticeText(r, base, week, "1시간", "2시간"), /▶ 서진원[\s\S]*결과: 달성/);
});

test("주 중간: 들어온 날까지만 평균", () => {
  const data: PromoSpend = { naver_through: "2026-10-07", meta_through: "2026-10-08", naver: days("2026-10-05", 3, "서진원", 300), meta: [] };
  const r = computePromo(data, [{ staff_id: "a", name: "서진원", increment: 0, scope: "naver", in_team: true }], { start: "2026-09-28", end: "2026-10-04" }, { start: "2026-10-05", end: "2026-10-11" }, 0);
  assert.equal(r.people[0].days, 3);
  assert.equal(r.people[0].current, 300);
  assert.equal(r.complete, false);
});
