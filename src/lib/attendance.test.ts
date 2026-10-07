import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarCells, kstStamp, kstTime, monthDays, weekdayIndex } from "./attendance.ts";

test("한국 시간 표시·저장", () => {
  assert.equal(kstTime("2026-10-12T01:05:00Z"), "10:05");
  assert.equal(kstTime(null), "");
  assert.equal(kstStamp("2026-10-12", "9:30"), "2026-10-12T09:30:00+09:00");
  assert.equal(kstStamp("2026-10-12", ""), null);
  assert.throws(() => kstStamp("2026-10-12", "아홉시"));
});

test("달력 칸은 월요일부터", () => {
  assert.equal(weekdayIndex("2026-10-12"), 0); // 월
  assert.equal(weekdayIndex("2026-10-11"), 6); // 일
  const cells = calendarCells("2026-10"); // 10월 1일은 목요일
  assert.deepEqual(cells.slice(0, 4), [null, null, null, "2026-10-01"]);
  assert.equal(cells.length % 7, 0);
  assert.equal(monthDays("2026-02").end, "2026-02-28");
});
