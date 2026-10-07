import { test } from "node:test";
import assert from "node:assert/strict";
import { calcPay, EMPTY_AUTO, EMPTY_INPUTS, pickTier, teamAuto, type Profile, type Tier } from "./payroll.ts";

// 시험용 가상 구간표·가상 금액 (실제 요율·급여는 데이터베이스에만 있음)
const TIERS: Tier[] = [
  { kind: "sales_ae", min_spend: 40_000_000, rate: 0.05, rank_name: null, amount: null },
  { kind: "sales_ae", min_spend: 100_000_000, rate: 0.1, rank_name: null, amount: null },
  { kind: "nonsales_ae", min_spend: 40_000_000, rate: 0.01, rank_name: null, amount: null },
  { kind: "rank", min_spend: 50_000_000, rate: null, rank_name: "A", amount: 10_000 },
  { kind: "rank", min_spend: 150_000_000, rate: null, rank_name: "B", amount: 20_000 },
];
const base: Profile = {
  staff_id: "x", track: "sales_ae", base_pay: 0, cert_allowance: 0, probation: false, rank_allowance: false, viral_in_spend: false, other_in_spend: false,
  viral_rate: 0, derived_rate: 0, closing_rate: 0, team_rate: 0, markup_rate: 0, coupang_rate: 0, other_media_rate: 0,
};
const line = (r: ReturnType<typeof calcPay>, key: string) => r.lines.find((l) => l.key === key)?.amount;

test("영업 AE: 인계 계정은 마감 소진액에 넣고 직급수당 기준에서는 뺌, 바이럴·파생은 따로", () => {
  const p: Profile = { ...base, base_pay: 2_000_000, cert_allowance: 10_000, rank_allowance: true, viral_rate: 0.1, derived_rate: 0.04, coupang_rate: 0.2 };
  const r = calcPay(p, { ...EMPTY_INPUTS, naver_spend: 120_000_000, handover_spend: 40_000_000, coupang_fee: 100_000 }, { ...EMPTY_AUTO, viral_sales: 1_000_005, derived_sales: 500_000 }, TIERS, [{ label: "프로모션", amount: 30_000 }]);
  assert.equal(r.spend, 160_000_000);
  assert.equal(line(r, "closing"), 2_080_000); // 160,000,000 × 13% × 10%
  assert.equal(line(r, "rank"), 10_000); // 인계 빼고 1.2억 → A
  assert.equal(line(r, "viral"), 100_000); // 100,000.5 → 원 미만 버림
  assert.equal(line(r, "derived"), 20_000);
  assert.equal(line(r, "coupang"), 20_000);
  assert.equal(r.total, 2_000_000 + 10_000 + 2_080_000 + 10_000 + 100_000 + 20_000 + 20_000 + 30_000);
});

test("비영업 AE: 네이버 외 매체·바이럴을 마감 소진액에 합산, 구간 미달이면 인센티브 없음", () => {
  const p: Profile = { ...base, track: "nonsales_ae", base_pay: 2_000_000, viral_in_spend: true, other_in_spend: true };
  const r = calcPay(p, { ...EMPTY_INPUTS, naver_spend: 30_000_000, other_spend: 5_000_000 }, { ...EMPTY_AUTO, viral_sales: 5_000_000 }, TIERS);
  assert.equal(r.spend, 40_000_000);
  assert.equal(line(r, "closing"), 52_000);
  const low = calcPay(p, { ...EMPTY_INPUTS, naver_spend: 10_000_000 }, EMPTY_AUTO, TIERS);
  assert.equal(line(low, "closing"), undefined);
  assert.equal(low.total, 2_000_000);
});

test("매니저: (본인 + 팀장) 네이버 외 매체 × 0.2%", () => {
  const p: Profile = { ...base, track: "nonsales_ae", base_pay: 1_000_000, other_media_rate: 0.002 };
  const r = calcPay(p, { ...EMPTY_INPUTS, other_spend: 1_000_000 }, { ...EMPTY_AUTO, lead_other_spend: 9_000_000 }, TIERS);
  assert.equal(line(r, "other_media"), 20_000);
});

test("팀장: 마감 매출 1.5% + 팀원 네이버 소진액 0.1% + 마크업(VAT 포함 ÷ 1.1) 20%", () => {
  const p: Profile = { ...base, track: "lead", base_pay: 3_000_000, closing_rate: 0.015, team_rate: 0.001, markup_rate: 0.2 };
  const team = teamAuto(
    [
      { profile: p, inputs: { ...EMPTY_INPUTS, naver_spend: 10_000_000, other_spend: 7_000_000 } },
      { profile: { ...p, track: "sales_ae" }, inputs: { ...EMPTY_INPUTS, naver_spend: 100_000_000, handover_spend: 50_000_000 } },
      { profile: { ...p, track: "nonsales_ae" }, inputs: { ...EMPTY_INPUTS, naver_spend: 20_000_000 } },
    ],
    100_000_000,
    100_000,
  );
  assert.equal(team.teamNaver, 120_000_000);
  assert.equal(team.leadOther, 7_000_000);
  assert.equal(team.bonus, 100_000);
  const r = calcPay(p, { ...EMPTY_INPUTS, naver_spend: 10_000_000, other_spend: 7_000_000, markup_fee: 1_100_000 }, { ...EMPTY_AUTO, team_naver: team.teamNaver, team_bonus: team.bonus }, TIERS);
  assert.equal(line(r, "closing"), 150_000); // 네이버 외 매체는 팀장 마감 매출에 넣지 않음
  assert.equal(line(r, "team"), 120_000);
  assert.equal(line(r, "markup"), 200_000);
  assert.equal(line(r, "team_bonus"), 100_000);
});

test("구간: 경계값 포함, 가장 낮은 구간 미만이면 없음", () => {
  assert.equal(pickTier(TIERS, "rank", 49_999_999), null);
  assert.equal(pickTier(TIERS, "rank", 50_000_000)?.rank_name, "A");
  assert.equal(pickTier(TIERS, "sales_ae", 500_000_000)?.rate, 0.1);
});

test("인계 첫 달 80%, 수습 기본급 90%, 마크업 미입금 50% 차감", () => {
  const p: Profile = { ...base, track: "nonsales_ae", base_pay: 2_000_000, probation: true };
  const r = calcPay(p, { ...EMPTY_INPUTS, naver_spend: 30_000_000, handover_new_spend: 12_500_000, unpaid_markup_fee: 330_000 }, EMPTY_AUTO, TIERS);
  assert.equal(r.spend, 40_000_000);
  assert.equal(line(r, "base"), 1_800_000);
  assert.equal(line(r, "closing"), 52_000);
  assert.equal(line(r, "unpaid"), -165_000);
});
