import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleLabel, dueToday, isDue, upcoming, type Routine } from "./routines.ts";

const base: Routine = { id: "r", kind: "daily", weekdays: [], month_day: null, due_date: null, start_date: "2026-09-01", is_active: true };

test("평일 매일: 주말은 없음, 못 한 날은 넘기지 않음", () => {
  assert.equal(isDue(base, "2026-10-08"), true); // 목
  assert.equal(isDue(base, "2026-10-10"), false); // 토
  assert.deepEqual(dueToday(base, "2026-10-08", new Set()), { date: "2026-10-08", late: 0 });
  assert.equal(dueToday(base, "2026-10-08", new Set(["2026-10-08"])), null);
  assert.equal(dueToday(base, "2026-10-10", new Set()), null);
});

test("매주 월요일 보고서: 월요일에 못 하면 완료할 때까지 계속 보임", () => {
  const r = { ...base, kind: "weekly" as const, weekdays: [1] };
  assert.deepEqual(dueToday(r, "2026-10-05", new Set()), { date: "2026-10-05", late: 0 });
  assert.deepEqual(dueToday(r, "2026-10-08", new Set()), { date: "2026-10-05", late: 3 });
  assert.equal(dueToday(r, "2026-10-08", new Set(["2026-10-05"])), null);
});

test("매월 31일은 말일로", () => {
  const r = { ...base, kind: "monthly" as const, month_day: 31 };
  assert.equal(isDue(r, "2026-09-30"), true);
  assert.equal(isDue(r, "2026-10-31"), true);
  assert.equal(isDue(r, "2026-10-30"), false);
});

test("약속: 날짜가 되면 보이고, 지나도 완료 전까지 보임", () => {
  const r = { ...base, kind: "once" as const, due_date: "2026-10-07" };
  assert.equal(dueToday(r, "2026-10-06", new Set()), null);
  assert.deepEqual(dueToday(r, "2026-10-08", new Set()), { date: "2026-10-07", late: 1 });
  assert.equal(dueToday(r, "2026-10-08", new Set(["2026-10-07"])), null);
});

test("시작일 전에는 없음, 다가오는 일정", () => {
  const r = { ...base, kind: "weekly" as const, weekdays: [1, 4], start_date: "2026-10-09" };
  assert.equal(dueToday(r, "2026-10-08", new Set()), null);
  assert.deepEqual(upcoming(r, "2026-10-08", 7), ["2026-10-12", "2026-10-15"]);
  assert.equal(cycleLabel({ ...r, due_time: "11:00:00" }), "매주 월·목 11:00");
});
