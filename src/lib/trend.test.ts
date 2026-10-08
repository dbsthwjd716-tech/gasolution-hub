import { test } from "node:test";
import assert from "node:assert/strict";
import { dailySeries, trendEnd } from "./trend.ts";

const data = {
  naver_through: "2026-10-06",
  meta_through: "2026-10-07",
  naver: [
    { d: "2026-10-06", m: "서진원", v: 100 },
    { d: "2026-10-05", m: "박규진", v: 50 },
    { d: "2026-10-03", m: "서진원", v: 30 },
  ],
  meta: [{ d: "2026-10-06", m: "박규진", v: 20 }],
};

test("끝 날짜는 두 데이터가 모두 있는 날", () => {
  assert.equal(trendEnd(data, "2026-10-08"), "2026-10-06");
  assert.equal(trendEnd({ ...data, meta_through: null }, "2026-10-08"), "2026-10-06");
  assert.equal(trendEnd({ ...data, naver_through: null, meta_through: null }, "2026-10-08"), null);
  assert.equal(trendEnd({ ...data, naver_through: "2026-10-09", meta_through: null }, "2026-10-08"), "2026-10-07");
});

test("최근 기간과 직전 기간을 날짜별로 합산", () => {
  const s = dailySeries(data, "2026-10-06", 3, null);
  assert.deepEqual(s.cur.map((p) => p.d), ["2026-10-04", "2026-10-05", "2026-10-06"]);
  assert.deepEqual(s.cur.map((p) => p.v), [0, 50, 120]);
  assert.deepEqual(s.prev.map((p) => p.v), [0, 0, 30]);
  assert.equal(s.curTotal, 170);
  assert.equal(s.prevTotal, 30);
});

test("담당자만 보기", () => {
  const s = dailySeries(data, "2026-10-06", 3, ["서진원"]);
  assert.equal(s.curTotal, 100);
});
