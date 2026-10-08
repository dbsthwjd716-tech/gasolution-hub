import { test } from "node:test";
import assert from "node:assert/strict";
import { changePct, hiddenReason, jobState, netCost, opsActions, sortBy, sortRows, summarize, type BizRow } from "./ads.ts";

const row = (o: Partial<BizRow>): BizRow => ({
  customer_id: "1", advertiser_name: "가", manager: "김직원", source: "naver_api", key_source: "group", bizmoney: 1000000,
  gross_total_cost: 1100000, gross_daily_average: 110000, calculation_days: 10, period_start: "2026-10-01", period_end: "2026-10-10",
  expected_days: 9, status: "normal", reason: null, error: null, captured_at: null, prev_period_start: "2026-09-01", prev_period_end: "2026-09-10",
  prev_active: true, prev_total_cost: 500000, prev_daily_average: 50000, transferred_at: null, adcost_source: "auto", gfa_ad_account_no: null, client_group: null,
  ...o,
});

test("VAT: 네이버 기록은 ÷1.1, 피이관은 그대로", () => {
  assert.equal(netCost(row({})), 1000000);
  assert.equal(netCost(row({ source: "transferred", gross_total_cost: 300000 })), 300000);
});

test("자동 숨김과 정렬", () => {
  assert.equal(hiddenReason(row({ gross_total_cost: 0 })), "zero");
  assert.equal(hiddenReason(row({ gross_total_cost: 0, status: "failed" })), null);
  assert.equal(hiddenReason(row({ source: "transferred", transferred_at: "2026-08-20" })), "old_transferred");
  assert.equal(hiddenReason(row({ source: "transferred", transferred_at: "2026-10-03" })), null);
  const s = sortRows([row({ customer_id: "a" }), row({ customer_id: "b", status: "danger", gross_total_cost: 10 }), row({ customer_id: "c", gross_total_cost: 5500000 })]);
  assert.deepEqual(s.map((x) => x.customer_id), ["b", "c", "a"]);
});

test("요약: 월말 예상 = 일평균 × 그달 일수, 전월 대비", () => {
  const s = summarize([row({}), row({ status: "danger" })], "2026-10-08");
  assert.equal(s.cost, 2000000);
  assert.equal(s.forecast, 100000 * 2 * 31);
  assert.equal(s.danger, 1);
  assert.equal(changePct(s.cost, s.prevCost), 100);
  assert.equal(changePct(1, 0), null);
});

test("오늘의 운영: 위험(소진 있을 때만)·소진 중단·급변", () => {
  const rows = [
    row({ customer_id: "1", status: "danger", reason: "잔액 10만원 이하" }),
    row({ customer_id: "2", status: "danger", gross_total_cost: 0 }),
    row({ customer_id: "3", gross_total_cost: 1000000 }),
    row({ customer_id: "4", gross_total_cost: 1200000 }),
  ];
  const prev = [
    { customer_id: "3", gross_total_cost: 1000000, gross_daily_average: 50000, source: "naver_api", period_start: "2026-10-01" },
    { customer_id: "4", gross_total_cost: 1000000, gross_daily_average: 50000, source: "naver_api", period_start: "2026-10-01" },
  ];
  const a = opsActions(rows, prev, "2026-10-08", "2026-10-07", "2026-10-08");
  assert.deepEqual(a.map((x) => `${x.type}:${x.customerId}`), ["bizmoney_danger:1", "spend_stopped:3", "spend_change:4"]);
  assert.equal(a[0].key, "bizmoney_danger:1:2026-10-08");
  assert.equal(opsActions(rows, prev, "2026-10-08", "2026-10-06", "2026-10-08").length, 1); // 하루 전 기록이 아니면 비교 안 함
});

test("자동 작업 상태", () => {
  assert.equal(jobState([], "x", 10.5, 9).state, "pending");
  assert.equal(jobState([], "x", 10.5, 11).state, "error");
  assert.equal(jobState([{ job: "x", started_at: "", finished_at: "t", ok: true }], "x", 10.5, 11).state, "ok");
});

test("비즈머니 현황 정렬: 기본 소진 많은 순, 비즈머니·일평균 오름/내림, 피이관은 비즈머니 정렬에서 맨 뒤", () => {
  const mk = (id: string, cost: number, biz: number | null, daily: number, source = "naver_api") =>
    ({ customer_id: id, advertiser_name: id, source, gross_total_cost: cost, bizmoney: biz, gross_daily_average: daily, status: "normal" }) as never;
  const rows = [mk("a", 110, 500, 11), mk("b", 330, 100, 33), mk("c", 220, null, 5, "transferred")];
  assert.deepEqual(sortBy(rows, "cost", "desc").map((r) => r.customer_id), ["b", "c", "a"]);
  assert.deepEqual(sortBy(rows, "cost", "asc").map((r) => r.customer_id), ["a", "c", "b"]);
  assert.deepEqual(sortBy(rows, "bizmoney", "asc").map((r) => r.customer_id), ["b", "a", "c"]);
  assert.deepEqual(sortBy(rows, "bizmoney", "desc").map((r) => r.customer_id), ["a", "b", "c"]);
  assert.deepEqual(sortBy(rows, "daily", "desc").map((r) => r.customer_id), ["b", "a", "c"]);
});
