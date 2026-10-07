// 시트 옮기기 계획 시험 (가짜 데이터). 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidBizNo } from "./bizno.ts";
import { planViralImport, parseAmount, parseDate, parsePeriod } from "./viral-import.ts";

// 앞 9자리로 검증을 통과하는 가짜 사업자번호 만들기
function bizno(nine: string): string {
  for (let d = 0; d <= 9; d++) if (isValidBizNo(nine + d)) return `${nine.slice(0, 3)}-${nine.slice(3, 5)}-${nine.slice(5)}${d}`;
  throw new Error("no check digit");
}
const BN_A = bizno("111223333");
const BN_B = bizno("222334444");
const bump = (bn: string) => bn.slice(0, -1) + String((Number(bn.slice(-1)) + 1) % 10); // 끝자리 +1 (끌어 채우기 실수)

// 시트 한 줄: A번호 B날짜 C내용 D업체 E대표 F사업자 G주소 H메일 I등록증 J공급가 K판매가 L담당 M입금 N계산서 O협력사결제 P협력사입금액 Q협력사계산서
const row = (o: Partial<Record<string, string>>) => [
  o.no ?? "1", o.date ?? "2025. 11. 05", o.desc ?? "블로그 10일", o.company ?? "가나상사", o.rep ?? "김대표",
  o.bn ?? BN_A, o.addr ?? "", o.mail ?? "a@a.kr", o.reg ?? "Y", o.cost ?? "59,400", o.sale ?? "132,000",
  o.mgr ?? "서진원", o.paid ?? "", o.inv ?? "", o.ppaid ?? "", o.pamt ?? "", o.pinv ?? "",
];

test("날짜·금액 읽기", () => {
  assert.equal(parseDate("2025. 11. 05"), "2025-11-05");
  assert.equal(parseDate("2025-2-30"), null);
  assert.equal(parseAmount("1,320,000원"), 1320000);
  assert.equal(parseAmount("미정"), null);
});

test("같은 사업자번호의 여러 줄은 거래처 하나로 묶임", () => {
  const p = planViralImport({ 제이솔: [row({}), row({ company: "가나 상사", date: "2025.11.07" })] });
  assert.equal(p.clients.length, 1);
  assert.equal(p.clients[0].orderCount, 2);
  assert.equal(p.orders.length, 2);
  assert.equal(p.totals.saleAmount, 264000);
});

test("끌어 채우다 끝자리가 늘어난 사업자번호는 같은 업체의 올바른 번호로 연결하고 확인 목록에 올림", () => {
  const p = planViralImport({
    제이솔: [row({ company: "프라임", bn: BN_B }), row({ company: "프라임", bn: bump(BN_B) }), row({ company: "프라임", bn: bump(bump(BN_B)) })],
  });
  assert.equal(p.clients.length, 1);
  assert.equal(p.clients[0].businessNumber, BN_B.replace(/-/g, ""));
  assert.equal(p.warnings.filter((w) => w.kind === "invalid_bizno").length, 2);
});

test("올바른 번호가 하나도 없으면 임시 거래처(사업자번호 없음)로 옮김", () => {
  const p = planViralImport({ 풀림: [row({ company: "오타상회", bn: bump(BN_A) })] });
  assert.equal(p.clients[0].businessNumber, null);
  assert.equal(p.clients[0].key, "name:오타상회");
});

test("칸이 한 칸 밀린 탭도 날짜 위치로 맞춰 읽음 (애드매니저 3,614,200원 누락 사례)", () => {
  const shifted = ["", ...row({ company: "똑똑홀딩스", sale: "3,614,200", date: "2026. 06. 05" })];
  const p = planViralImport({ 애드매니저: [shifted] });
  assert.equal(p.orders.length, 1);
  assert.equal(p.orders[0].saleAmount, 3614200);
  assert.equal(p.orders[0].tab, "애드매니저");
  assert.ok(p.warnings.some((w) => w.kind === "column_shift"));
});

test("필수 칸이 빠진 줄은 건너뛰고 이유를 남김, 빈 줄은 무시", () => {
  const p = planViralImport({
    포에스: [row({ date: "" }), row({ company: "" }), row({ sale: "미정" }), row({ mgr: "" }), Array(17).fill("")],
  });
  assert.equal(p.orders.length, 0);
  assert.deepEqual(p.skipped.map((s) => s.kind), ["missing_date", "missing_company", "missing_amount", "missing_manager"]);
  assert.equal(p.totals.rows, 4);
});

test("담당자 칸 정리와 진행 상태 읽기", () => {
  const p = planViralImport(
    { 제이솔: [row({ mgr: "서진원 ", paid: "김대표 132,000 입금", inv: "O", ppaid: "O", pamt: "59400" })] },
    { managers: ["서진원"] },
  );
  const o = p.orders[0];
  assert.equal(o.manager, "서진원");
  assert.equal(o.paymentReceived, true);
  assert.equal(o.invoiceIssued, true);
  assert.equal(o.partnerPaid, true);
  assert.equal(o.partnerPaidAmount, 59400);
});

test("이름이 같은데 올바른 사업자번호가 둘이면 같은 회사인지 확인 요청", () => {
  const p = planViralImport({ 제이솔: [row({ company: "정성치과", bn: BN_A }), row({ company: "정성치과", bn: BN_B })] });
  assert.equal(p.clients.length, 2);
  assert.ok(p.warnings.some((w) => w.kind === "bizno_conflict"));
});

test("공급가(VAT 포함)를 VAT 별도로 환산해 판매가보다 크면 확인 요청", () => {
  // 공급가 110,000(VAT 포함) = 100,000(VAT 별도) → 판매가 100,000이면 마진 0, 경고 없음
  const ok = planViralImport({ 제이솔: [row({ cost: "110,000", sale: "100,000" })] });
  assert.ok(!ok.warnings.some((w) => w.kind === "cost_over_sale"));
  const bad = planViralImport({ 제이솔: [row({ cost: "121,000", sale: "100,000" })] });
  assert.ok(bad.warnings.some((w) => w.kind === "cost_over_sale"));
});

test("날짜 칸에 '입금전'이면 건너뛰지 않고 입금 전 건으로 옮김", () => {
  const p = planViralImport({ 제이솔: [row({ date: "입금전", paid: "", desc: "26.10.01~26.10.30(30일)" })] });
  assert.equal(p.orders.length, 1);
  assert.equal(p.orders[0].paidDate, null);
  assert.equal(p.orders[0].paymentReceived, false);
  assert.equal(p.orders[0].startDate, "2026-10-01");
  assert.equal(p.orders[0].endDate, "2026-10-30");
  assert.ok(p.warnings.some((w) => w.kind === "unpaid"));
});

test("판매가가 빈 서비스 건은 0원으로 옮기고 확인 목록에 표시", () => {
  const p = planViralImport({ 포에스: [row({ sale: "" })] });
  assert.equal(p.orders.length, 1);
  assert.equal(p.orders[0].saleAmount, 0);
  assert.ok(p.warnings.some((w) => w.kind === "no_sale_amount"));
});

test("마이너스 금액(환불·취소)도 그대로 옮기고 확인 목록에 표시", () => {
  const p = planViralImport({ 풀림: [row({ sale: "-132,000", cost: "-59,400" })] });
  assert.equal(p.orders[0].saleAmount, -132000);
  assert.equal(p.orders[0].costAmount, -59400);
  assert.ok(p.warnings.some((w) => w.kind === "negative_amount"));
  assert.equal(p.totals.saleAmount, -132000);
});

test("기간 칸에서 시작일·끝나는 날 읽기", () => {
  assert.deepEqual(parsePeriod("25.11.05~25.11.14(10일)"), { start: "2025-11-05", end: "2025-11-14" });
  assert.deepEqual(parsePeriod("2025. 11. 21~ 플레이스 최적화"), { start: "2025-11-21", end: null });
  assert.deepEqual(parsePeriod("블로그리뷰50건"), { start: null, end: null });
});
