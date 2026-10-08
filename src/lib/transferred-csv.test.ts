import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDate, parseCsvLine, parseTransferredCsv } from "./transferred-csv.ts";

test("CSV 한 줄: 따옴표 안 쉼표", () => {
  assert.deepEqual(parseCsvLine('2026-10-01,"주식회사 가,나",1234,"1,000"'), ["2026-10-01", "주식회사 가,나", "1234", "1,000"]);
});

test("날짜 여러 모양", () => {
  assert.equal(normalizeDate("2026.10.1"), "2026-10-01");
  assert.equal(normalizeDate("20261001"), "2026-10-01");
  assert.equal(normalizeDate("2026/10/01"), "2026-10-01");
  assert.equal(normalizeDate("합계"), null);
});

test("유상실적 CSV: 필수 열·합계 줄 건너뛰기·금액 정리", () => {
  const csv = "﻿날짜,광고계정 CustomerID,광고주명,유상실적TOTAL,기타\n2026.10.01,123,가게,\"10,000원\",x\n2026-10-02,123,가게,5000,x\n합계,,,15000,\n";
  const r = parseTransferredCsv(csv);
  assert.ok(!("error" in r));
  if ("error" in r) return;
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].v, 10000);
  assert.equal(r.start, "2026-10-01");
  assert.equal(r.end, "2026-10-02");
  assert.equal(r.skipped, 1);
  assert.equal(r.total, 15000);
});

test("열이 없으면 알려 줌", () => {
  const r = parseTransferredCsv("날짜,광고주명\n2026-10-01,가\n");
  assert.ok("error" in r && r.error.includes("광고계정 CustomerID"));
});
