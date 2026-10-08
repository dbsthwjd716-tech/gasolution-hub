import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignTypeLabel, determineStatus, extractStat, prevMonthSameDay } from "./ads-jobs/rules.ts";

test("비즈머니 상태: 예전 대시보드와 같은 기준", () => {
  assert.deepEqual(determineStatus(90_000, 20), { status: "danger", reason: "잔액 10만원 이하" });
  assert.deepEqual(determineStatus(400_000, 2.5), { status: "danger", reason: "잔액 50만원 이하 · 예상 소진일 3일 이하" });
  assert.deepEqual(determineStatus(2_000_000, 6), { status: "warning", reason: "예상 소진일 7일 이하" });
  assert.deepEqual(determineStatus(2_000_000, null), { status: "normal", reason: "잔액 및 소진속도 정상" });
});

test("전월 같은 날짜: 말일 넘으면 말일, 1월은 작년 12월", () => {
  assert.equal(prevMonthSameDay("2026-03-31"), "2026-02-28");
  assert.equal(prevMonthSameDay("2026-01-15"), "2025-12-15");
  assert.equal(prevMonthSameDay("2026-10-01"), "2026-09-01");
});

test("검색광고 캠페인 종류·통계 꺼내기", () => {
  assert.equal(campaignTypeLabel("web_site"), "파워링크");
  assert.equal(campaignTypeLabel("PLACE"), "PLACE");
  assert.equal(campaignTypeLabel(null), "기타");
  assert.deepEqual(extractStat({ data: [{ impCnt: 3 }] }), { impCnt: 3 });
  assert.deepEqual(extractStat([{ clkCnt: 1 }]), { clkCnt: 1 });
  assert.deepEqual(extractStat(null), {});
});
