// 바이럴 상품 종류·매체·단가 계산·발행요청 문구 (입력 화면·서버·시험 공통)

export const PRODUCT_TYPES = ["슬롯", "가구매", "가구매 제품비", "가구매 택배 대행비", "블로그 배포", "카페침투", "플레이스 트래픽", "기타"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const PLATFORMS = ["네이버", "쿠팡", "인스타"];
export const SLOT_DAYS = [10, 20, 30];

export type PriceRow = {
  id: string;
  partner_id: string;
  product_type: string;
  platform: string | null;
  product_name: string | null;
  days: number | null;
  unit_label: string;
  cost_price: number | null; // 공급가 보기 권한이 없으면 null
  sale_price: number;
};

// 가장 잘 맞는 단가: 협력사·종류는 같아야 하고, 매체·상품명·일수는 정확히 맞는 쪽을 우선 (비어 있는 단가는 공통)
export function findPrice(list: PriceRow[], q: { partnerId: string; productType: string; platform?: string | null; productName?: string | null; days?: number | null }) {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "").toLowerCase();
  let best: PriceRow | null = null;
  let bestScore = -1;
  for (const p of list) {
    if (p.partner_id !== q.partnerId || p.product_type !== q.productType) continue;
    let score = 0;
    if (p.platform) { if (norm(p.platform) !== norm(q.platform)) continue; score += 1; }
    if (p.product_name) { if (norm(p.product_name) !== norm(q.productName)) continue; score += 2; }
    if (p.days) { if (p.days !== q.days) continue; score += 4; }
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

export function lineAmounts(price: Pick<PriceRow, "cost_price" | "sale_price">, quantity: number) {
  const q = Number(quantity) || 0;
  return { cost: price.cost_price == null ? null : Math.round(price.cost_price * q), sale: Math.round(price.sale_price * q) };
}

// 시작일 + 일수 → 끝나는 날 (시작일 포함: 10/4부터 30일 → 11/2)
export function endDate(start: string, days: number) {
  if (!start || !days) return "";
  const d = new Date(start + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

// 상품 설명: "(30일) 메이크 2슬롯"
export function describeItem(i: { product_type: string; product_name?: string | null; days?: number | null; quantity?: number | null; start_date?: string | null; end_date?: string | null; platform?: string | null }) {
  // 날짜는 시작일·끝나는 날 칸에 따로 있으므로 설명에는 일수만: "(30일) 메이크 2슬롯"
  const parts: string[] = [];
  if (i.days) parts.push(`(${i.days}일)`);
  if (i.product_type === "슬롯") {
    parts.push([i.product_name, i.quantity ? `${Number(i.quantity)}슬롯` : "슬롯"].filter(Boolean).join(" "));
  } else {
    parts.push([i.product_name, i.product_type === "기타" ? "" : i.product_type, i.quantity ? `${Number(i.quantity)}건` : ""].filter(Boolean).join(" "));
  }
  return parts.join(" ").trim();
}

// 발행요청 문구에서 상품을 부르는 이름 (슬롯 → 리워드)
const TYPE_IN_REQUEST: Record<string, string> = { 슬롯: "리워드" };

export function viralRequestText(o: {
  paidDate: string | null;
  company: string;
  representative: string | null;
  businessNumber: string | null;
  emails: string[];
  hasRegistration: boolean;
  items: { description: string | null; product_type: string | null; platform: string | null; sale_amount: number; start_date?: string | null; end_date?: string | null }[];
}) {
  const ymd = (d: string) => `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
  // 설명에 날짜가 없으면 시작일~끝나는 날을 앞에 붙임: "26.10.04~26.11.02(30일) 메이크 2슬롯"
  const line = (i: { description: string | null; start_date?: string | null; end_date?: string | null }) =>
    i.description && i.start_date && !/^\d{2}\.\d{2}\.\d{2}/.test(i.description)
      ? `${ymd(i.start_date)}~${i.end_date ? ymd(i.end_date) : ""}${i.description.startsWith("(") ? "" : " "}${i.description}`
      : i.description;
  const md = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
  const won = (n: number) => n.toLocaleString("ko-KR") + "원";
  const costs = o.items
    .filter((i) => i.sale_amount)
    .map((i) => `${i.platform ?? ""}${i.product_type ? (TYPE_IN_REQUEST[i.product_type] ?? i.product_type) : ""} ${won(i.sale_amount)}`.trim());
  const total = o.items.reduce((t, i) => t + i.sale_amount, 0);
  return [
    "세금계산서 발행요청",
    `입금 ${o.paidDate ? md(o.paidDate) : "전"}`,
    ...o.items.map(line).filter(Boolean),
    "",
    `1. 업체: ${o.company}`,
    `2. 대표자: ${o.representative ?? ""}`,
    `3. 사업자번호: ${o.businessNumber ?? ""}`,
    `4. 견적비용 : ${costs.join(", ")}${costs.length > 1 ? ` (합계 ${won(total)})` : ""}`,
    `5. 자료 첨부 여부(사업자등록증): ${o.hasRegistration ? "Y" : "N"}`,
    `6. 세금계산서 발행 메일 : ${o.emails.join(", ")}`,
  ].join("\n");
}

export const CREDIT_ENTRY_LABEL: Record<string, string> = {
  refund_issued: "환불 발생",
  refund_paid: "환급 지급",
  refund_applied: "다음 건에서 차감",
  prepaid_received: "미소진 발생 (더 받아 둠)",
  prepaid_used: "미소진 사용",
};

// 단가표에 없는 상품의 기본 판매가: 공급가(VAT 포함) ÷ 0.7, 100원 미만 버림 (예: 176,000 → 251,400)
export function defaultSale(cost: number) {
  if (!cost || cost <= 0) return 0;
  return Math.floor(cost / 0.7 / 100) * 100;
}

// 시트의 판매가가 '공급가 ÷ 0.7' 규칙으로 정한 금액이면 VAT 포함 가격 → VAT 별도로 바꿔 저장
export function sheetSaleToNet(cost: number, sale: number) {
  if (cost > 0 && sale === defaultSale(cost)) return Math.round(sale / 1.1);
  return sale;
}
