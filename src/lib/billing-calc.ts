// 정산·견적 금액 계산 (화면 미리보기와 저장이 같은 계산을 씀)

export type MarkupType = "rate" | "fixed" | "none";
export type VatMode = "included" | "excluded";
export type DocType = "settlement" | "viral_estimate" | "detailed_estimate" | "simple_estimate";
export type BillingStatus = "draft" | "requested" | "lead_approved" | "approved" | "issued" | "rejected" | "cancelled";

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  settlement: "광고비 정산",
  viral_estimate: "바이럴 견적서",
  detailed_estimate: "상세 견적서",
  simple_estimate: "간단 견적서",
};

export const STATUS_LABEL: Record<BillingStatus, string> = {
  draft: "작성중",
  requested: "승인 요청",
  lead_approved: "1차 승인 · 대표 확인 대기",
  approved: "승인 완료 · 발행 대기",
  issued: "세금계산서 발행 완료",
  rejected: "반려",
  cancelled: "취소",
};

export const ESTIMATE_STATUS_LABEL: Partial<Record<BillingStatus, string>> = {
  requested: "확인 요청",
  approved: "확인 완료",
};

export function statusLabel(docType: DocType, status: BillingStatus) {
  return (docType !== "settlement" && ESTIMATE_STATUS_LABEL[status]) || STATUS_LABEL[status];
}

export const CONTRACT_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "작성중", cls: "chip-muted" },
  signing: { label: "서명 진행중", cls: "chip-info" },
  active: { label: "계약 완료", cls: "chip-ok" },
  on_hold: { label: "보류", cls: "chip-warn" },
  rejected: { label: "반려", cls: "chip-warn" },
  ended: { label: "종료", cls: "chip-muted" },
};

export type SettlementInput = {
  spend: number; // 광고비 소진액 (계산 기준, 청구하지 않음)
  markupType: MarkupType;
  markupRate: number; // %
  markupFixed: number;
  minFee: number; // 최소 대행비 (VAT 포함 금액으로 적음)
  vatMode: VatMode; // included: 마크업에 VAT 포함 / excluded: 마크업에 VAT 10% 별도
  adjustment: number; // 추가(+)/차감(-)
};

export type SettlementResult = {
  rawMarkup: number; // 요율·고정비로 계산한 마크업
  markup: number; // 최소 대행비 반영 후 마크업
  minApplied: boolean;
  supply: number;
  vat: number;
  adjustment: number;
  total: number;
};

const int = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

export function calcSettlement(i: SettlementInput): SettlementResult {
  const spend = int(i.spend);
  const raw =
    i.markupType === "rate"
      ? int((spend * (Number(i.markupRate) || 0)) / 100)
      : i.markupType === "fixed"
        ? int(i.markupFixed)
        : 0;
  // 최소 대행비는 VAT 포함 금액. 마크업이 VAT 별도면 공급가 기준(÷1.1)으로 비교
  const minInMode = i.vatMode === "included" ? int(i.minFee) : int(i.minFee / 1.1);
  const minApplied = i.markupType !== "none" && minInMode > 0 && raw < minInMode;
  const markup = minApplied ? minInMode : raw;
  const adjustment = int(i.adjustment);
  let supply: number, vat: number;
  if (i.vatMode === "included") {
    vat = int(markup - markup / 1.1);
    supply = markup - vat;
  } else {
    supply = markup;
    vat = int(markup * 0.1);
  }
  return { rawMarkup: raw, markup, minApplied, supply, vat, adjustment, total: supply + vat + adjustment };
}

// 견적 품목: 단가는 VAT 포함
export function calcEstimateLine(unitPrice: number, quantity: number) {
  const total = int((Number(unitPrice) || 0) * (Number(quantity) || 0));
  const supply = int(total / 1.1);
  return { supply, vat: total - supply, total };
}

export function calcEstimate(lines: { unitPrice: number; quantity: number }[], adjustment = 0) {
  let supply = 0;
  let vat = 0;
  for (const l of lines) {
    const r = calcEstimateLine(l.unitPrice, l.quantity);
    supply += r.supply;
    vat += r.vat;
  }
  const adj = int(adjustment);
  return { supply, vat, adjustment: adj, total: supply + vat + adj };
}

// 한국 시간 기준 오늘과 지난달 1일~말일
export function todayKST(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
}

export function previousMonthRange(today: string) {
  const [y, m] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, "0");
  return { start: `${py}-${mm}-01`, end: `${py}-${mm}-${String(last).padStart(2, "0")}` };
}

export const won = (n: number | null | undefined) => (Number(n) || 0).toLocaleString("ko-KR") + "원";

export function markupText(t: MarkupType, rate: number, fixed: number) {
  if (t === "rate") return `${Number(rate)}%`;
  if (t === "fixed") return `고정 ${won(fixed)}`;
  return "없음";
}

const md = (d: string | null | undefined) => {
  if (!d) return "";
  const [, m, day] = d.split("-").map(Number);
  return `${m}월 ${day}일`;
};

// 세금계산서 발행 담당에게 보낼 요청 문구 (메신저에 붙여 넣기용)
export function requestText(d: {
  supplierName: string;
  company: string;
  representative: string | null;
  businessNumber: string | null;
  emails: string[];
  periodStart: string | null;
  periodEnd: string | null;
  spend: number;
  markupType: MarkupType;
  markupRate: number;
  markup: number;
  minApplied: boolean;
  vatMode: VatMode;
  adjustment: number;
  adjustmentReason: string | null;
  total: number;
  hasRegistration: boolean;
  evidenceCount: number;
  staffName: string;
}) {
  const basis =
    d.markupType === "rate"
      ? `${won(d.spend)} × ${Number(d.markupRate)}% = ${won(d.markup)}${d.minApplied ? " (최소 대행비 적용)" : ""}`
      : won(d.markup);
  const lines = [
    "[세금계산서 발행요청]",
    d.periodStart ? `(${md(d.periodStart)} ~ ${md(d.periodEnd)})` : "",
    "",
    `발행 사업장: ${d.supplierName}`,
    `업체: ${d.company} / 대표자: ${d.representative ?? "-"} / 사업자번호: ${d.businessNumber ?? "-"} / 발행 메일: ${d.emails.join(", ") || "-"}`,
    "",
    `광고비 소진액(계산 기준): ${won(d.spend)}`,
    `마크업 비용: ${basis}`,
    d.adjustment ? `추가/차감: ${won(d.adjustment)} (${d.adjustmentReason ?? ""})` : "",
    `세금계산서 발행 요청금액: ${won(d.total)}`,
    `VAT: ${d.vatMode === "included" ? "포함" : "별도"}`,
    "",
    `첨부자료: 사업자등록증 ${d.hasRegistration ? "Y" : "N"} / 소진내역 ${d.evidenceCount > 0 ? "Y" : "N"}`,
    `요청 담당자: ${d.staffName}`,
  ];
  return lines.filter((l, i) => l !== "" || (i > 0 && lines[i - 1] !== "")).join("\n").trim();
}
