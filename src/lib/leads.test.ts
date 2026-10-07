import { test } from "node:test";
import assert from "node:assert/strict";
import { businessDaysBetween, followUp, formatKST, forwardText, normalizeCompany, parseInquiryAt } from "./leads.ts";

test("문의시간: 메타 알림 형식", () => {
  assert.equal(parseInquiryAt("2026년 10월 7일 화요일 14:30"), "2026-10-07T14:30:00+09:00");
  assert.equal(parseInquiryAt("2026년 10월 7일 (화요일) 9:05."), "2026-10-07T09:05:00+09:00");
  assert.equal(parseInquiryAt("2026년 10월 7일 오후 2:30"), "2026-10-07T14:30:00+09:00");
});

test("문의시간: 숫자 형식", () => {
  assert.equal(parseInquiryAt("26.10.7 14:30"), "2026-10-07T14:30:00+09:00");
  assert.equal(parseInquiryAt("2026-10-07 08:00"), "2026-10-07T08:00:00+09:00");
  assert.equal(parseInquiryAt("2026-10-07T08:00"), "2026-10-07T08:00:00+09:00");
  assert.equal(parseInquiryAt("2026/10/07"), "2026-10-07T00:00:00+09:00");
});

test("문의시간: 잘못된 날짜·세 자리 연도는 거부", () => {
  assert.equal(parseInquiryAt("2026-02-30 10:00"), null);
  assert.equal(parseInquiryAt("202.9.1 10:00"), null);
  assert.equal(parseInquiryAt("2026-10-07 25:00"), null);
  assert.equal(parseInquiryAt("어제 오후"), null);
});

test("한국 시간으로 표시", () => {
  assert.equal(formatKST("2026-10-07T05:30:00Z"), "2026년 10월 7일 수요일 14:30");
});

test("영업일: 주말 제외", () => {
  assert.equal(businessDaysBetween("2026-10-09", "2026-10-12"), 1); // 금 → 월
  assert.equal(businessDaysBetween("2026-10-05", "2026-10-08"), 3); // 월 → 목
  assert.equal(businessDaysBetween("2026-10-07", "2026-10-07"), 0);
});

test("연락 필요: 3영업일 지난 진행 중 문의만", () => {
  const base = { status: "연락 전", inquiry_at: "2026-10-05T01:00:00Z", last_contact_at: null, next_contact_on: null };
  assert.equal(followUp(base, "2026-10-07").needed, false);
  assert.equal(followUp(base, "2026-10-08").needed, true);
  assert.equal(followUp({ ...base, status: "계약완료" }, "2026-10-20").needed, false);
  assert.equal(followUp({ ...base, last_contact_at: "2026-10-07T01:00:00Z" }, "2026-10-08").needed, false);
});

test("연락 예정일이 있으면 그 날짜 기준", () => {
  const base = { status: "상담중", inquiry_at: "2026-09-01T01:00:00Z", last_contact_at: null, next_contact_on: "2026-10-10" };
  assert.equal(followUp(base, "2026-10-08").needed, false);
  assert.equal(followUp(base, "2026-10-10").needed, true);
});

test("업체명 비교는 (주)·띄어쓰기 무시", () => {
  assert.equal(normalizeCompany("(주) 우와해 선릉본점"), normalizeCompany("우와해선릉본점"));
});

test("전달 문구", () => {
  const t = forwardText({
    source: "SNS_DB", inquiry_at: "2026-10-07T05:30:00Z", company_name: "우와해", contact_name: "김사장", monthly_budget: 3000000,
    phone: "010-1234-5678", media: ["메타"], inquiry_content: "인스타 광고 문의", memo: null, staff_name: "박규진",
  });
  assert.match(t, /^메타 양식 문의/);
  assert.match(t, /예산 : 3,000,000/);
  assert.match(t, /@박규진 확인 부탁드립니다\.$/);
  assert.doesNotMatch(t, /비고/);
});
