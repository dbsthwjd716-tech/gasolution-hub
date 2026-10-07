import { test } from "node:test";
import assert from "node:assert/strict";
import { describeItem, endDate, findPrice, lineAmounts, viralRequestText, type PriceRow } from "./viral-products.ts";

const P = (o: Partial<PriceRow>): PriceRow => ({ id: Math.random().toString(), partner_id: "풀림", product_type: "슬롯", platform: null, product_name: null, days: null, unit_label: "슬롯", cost_price: 0, sale_price: 0, ...o });

test("단가: 일수·상품명이 정확히 맞는 단가를 우선", () => {
  const list = [
    P({ cost_price: 1, sale_price: 1 }),
    P({ days: 30, cost_price: 100000, sale_price: 180000 }),
    P({ days: 30, product_name: "메이크", cost_price: 110000, sale_price: 198000 }),
    P({ days: 10, product_name: "메이크", cost_price: 40000, sale_price: 66000 }),
    P({ partner_id: "제이솔", days: 30, product_name: "메이크", cost_price: 9, sale_price: 9 }),
  ];
  assert.equal(findPrice(list, { partnerId: "풀림", productType: "슬롯", productName: "메이크", days: 30 })?.sale_price, 198000);
  assert.equal(findPrice(list, { partnerId: "풀림", productType: "슬롯", productName: "자몽", days: 30 })?.sale_price, 180000);
  assert.equal(findPrice(list, { partnerId: "풀림", productType: "슬롯", days: 15 })?.sale_price, 1);
  assert.equal(findPrice(list, { partnerId: "포에스", productType: "슬롯", days: 30 }), null);
});

test("수량을 곱해 공급가·판매가", () => {
  assert.deepEqual(lineAmounts({ cost_price: 110000, sale_price: 198000 }, 2), { cost: 220000, sale: 396000 });
});

test("끝나는 날: 시작일 포함 30일", () => {
  assert.equal(endDate("2026-10-04", 30), "2026-11-02");
  assert.equal(endDate("2026-02-20", 10), "2026-03-01");
});

test("상품 설명을 시트 모양으로", () => {
  assert.equal(describeItem({ product_type: "슬롯", product_name: "메이크", days: 30, quantity: 2, start_date: "2026-10-04", end_date: "2026-11-02" }), "(30일) 메이크 2슬롯");
  assert.equal(describeItem({ product_type: "가구매", quantity: 100 }), "가구매 100건");
});

test("발행요청 문구", () => {
  const t = viralRequestText({
    paidDate: "2026-10-02", company: "용접공구", representative: "이병석", businessNumber: "122-01-55229", emails: ["dongyangwel@naver.com"], hasRegistration: true,
    items: [{ description: "26.10.04~26.11.02(30일) 메이크 2슬롯씩 30일 CUT-45k AIR 콤푸내장형", product_type: "슬롯", platform: "네이버", sale_amount: 396000 }],
  });
  assert.equal(t, `세금계산서 발행요청
입금 10/02
26.10.04~26.11.02(30일) 메이크 2슬롯씩 30일 CUT-45k AIR 콤푸내장형

1. 업체: 용접공구
2. 대표자: 이병석
3. 사업자번호: 122-01-55229
4. 견적비용 : 네이버리워드 396,000원
5. 자료 첨부 여부(사업자등록증): Y
6. 세금계산서 발행 메일 : dongyangwel@naver.com`);
});

test("발행요청 문구: 설명에 날짜가 없으면 기간을 앞에 붙임", () => {
  const t = viralRequestText({
    paidDate: "2026-10-02", company: "용접공구", representative: null, businessNumber: null, emails: [], hasRegistration: false,
    items: [{ description: "(30일) 메이크 2슬롯", product_type: "슬롯", platform: "네이버", sale_amount: 396000, start_date: "2026-10-04", end_date: "2026-11-02" }],
  });
  assert.match(t, /\n26\.10\.04~26\.11\.02\(30일\) 메이크 2슬롯\n/);
});
