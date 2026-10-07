import { test } from "node:test";
import assert from "node:assert/strict";
import { pickContract } from "./contract-pick.ts";
import { calcEstimate, calcEstimateLine, calcSettlement, previousMonthRange, requestText, todayKST } from "./billing-calc.ts";

const base = { spend: 0, markupType: "rate" as const, markupRate: 0, markupFixed: 0, minFee: 0, vatMode: "included" as const, adjustment: 0 };

test("메타 14.3% VAT 포함: 광고비 3,134,734원", () => {
  const r = calcSettlement({ ...base, spend: 3134734, markupRate: 14.3 });
  assert.equal(r.markup, 448267);
  assert.equal(r.supply + r.vat, 448267);
  assert.equal(r.vat, 40752);
  assert.equal(r.total, 448267);
});

test("VAT 별도면 마크업이 공급가, 부가세 10%를 더함", () => {
  const r = calcSettlement({ ...base, spend: 10_000_000, markupRate: 10, vatMode: "excluded" });
  assert.deepEqual([r.supply, r.vat, r.total], [1_000_000, 100_000, 1_100_000]);
});

test("최소 대행비 33만원(VAT 포함): 마크업이 적으면 33만원으로", () => {
  const r = calcSettlement({ ...base, spend: 1_000_000, markupRate: 14.3, minFee: 330000 });
  assert.equal(r.rawMarkup, 143000);
  assert.equal(r.markup, 330000);
  assert.equal(r.minApplied, true);
  assert.deepEqual([r.supply, r.vat], [300000, 30000]);
});

test("최소 대행비는 VAT 별도 계약이면 공급가 30만원 기준", () => {
  const r = calcSettlement({ ...base, spend: 1_000_000, markupRate: 10, minFee: 330000, vatMode: "excluded" });
  assert.deepEqual([r.markup, r.supply, r.vat, r.total], [300000, 300000, 30000, 330000]);
});

test("마크업 없음이면 최소 대행비도 안 붙음", () => {
  const r = calcSettlement({ ...base, spend: 1_000_000, markupType: "none", minFee: 330000 });
  assert.equal(r.total, 0);
});

test("고정비 + 차감: 합계 = 공급가 + 세액 + 차감", () => {
  const r = calcSettlement({ ...base, markupType: "fixed", markupFixed: 550000, adjustment: -50000 });
  assert.deepEqual([r.supply, r.vat, r.total], [500000, 50000, 500000]);
  assert.equal(r.total, r.supply + r.vat + r.adjustment);
});

test("견적 품목은 단가에 VAT 포함, 줄마다 공급가·세액 분리", () => {
  assert.deepEqual(calcEstimateLine(132000, 2), { supply: 240000, vat: 24000, total: 264000 });
  const e = calcEstimate([{ unitPrice: 132000, quantity: 2 }, { unitPrice: 10000, quantity: 1.5 }]);
  assert.equal(e.total, 279000);
  assert.equal(e.total, e.supply + e.vat);
});

test("지난달 범위 (1월이면 작년 12월)", () => {
  assert.deepEqual(previousMonthRange("2026-10-07"), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(previousMonthRange("2026-01-15"), { start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(previousMonthRange("2028-03-01"), { start: "2028-02-01", end: "2028-02-29" });
});

test("오늘 날짜는 한국 시간 (UTC 자정 직후도 한국 날짜)", () => {
  assert.equal(todayKST(new Date("2026-09-30T16:00:00Z")), "2026-10-01");
});

test("발행요청 문구", () => {
  const t = requestText({
    supplierName: "(주)지에이솔루션", company: "티키타카", representative: "홍길동", businessNumber: "122-01-55229",
    emails: ["a@x.kr"], periodStart: "2026-09-01", periodEnd: "2026-09-30", spend: 10_000_000, markupType: "rate",
    markupRate: 12.1, markup: 1_210_000, minApplied: false, vatMode: "included", adjustment: 0, adjustmentReason: null,
    total: 1_210_000, hasRegistration: true, evidenceCount: 2, staffName: "윤소정",
  });
  assert.match(t, /\(9월 1일 ~ 9월 30일\)/);
  assert.match(t, /10,000,000원 × 12.1% = 1,210,000원/);
  assert.match(t, /사업자등록증 Y \/ 소진내역 Y/);
  assert.doesNotMatch(t, /\n\n\n/);
});


test("작성일에 유효한 계약 중 가장 최근에 시작한 계약을 고름", () => {
  const ks = [
    { id: "old", client_id: "c", start_date: "2026-01-01", end_date: null, contract_date: "2026-01-01" },
    { id: "new", client_id: "c", start_date: "2026-09-01", end_date: null, contract_date: "2026-08-20" },
    { id: "future", client_id: "c", start_date: "2026-11-01", end_date: null, contract_date: "2026-10-01" },
    { id: "expired", client_id: "c", start_date: "2026-01-01", end_date: "2026-03-31", contract_date: "2026-01-01" },
    { id: "other", client_id: "x", start_date: null, end_date: null, contract_date: "2026-10-01" },
  ];
  assert.equal(pickContract(ks, "c", "2026-10-07")?.id, "new");
  assert.equal(pickContract(ks, "c", "2026-02-01")?.id, "old");
  assert.equal(pickContract(ks, "z", "2026-10-07"), null);
});
