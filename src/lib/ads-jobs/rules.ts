// 수집 계산 규칙 (예전 대시보드와 같음) — 서버 밖에서도 시험할 수 있게 따로 둠

const WARNING_BALANCE = 500_000, DANGER_BALANCE = 100_000, WARNING_DAYS = 7, DANGER_DAYS = 3;

export function determineStatus(bizmoney: number, expectedDays: number | null) {
  let b = 0, d = 0;
  const reasons: string[] = [];
  if (bizmoney <= DANGER_BALANCE) { b = 2; reasons.push("잔액 10만원 이하"); }
  else if (bizmoney <= WARNING_BALANCE) { b = 1; reasons.push("잔액 50만원 이하"); }
  if (expectedDays !== null) {
    if (expectedDays <= DANGER_DAYS) { d = 2; reasons.push("예상 소진일 3일 이하"); }
    else if (expectedDays <= WARNING_DAYS) { d = 1; reasons.push("예상 소진일 7일 이하"); }
  }
  const level = Math.max(b, d);
  return { status: level === 2 ? "danger" : level === 1 ? "warning" : "normal", reason: reasons.length ? reasons.join(" · ") : "잔액 및 소진속도 정상" };
}

// 전월 같은 날짜 (말일 넘으면 말일)
export function prevMonthSameDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const tm = m === 1 ? 12 : m - 1, ty = m === 1 ? y - 1 : y;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const TYPE_LABEL: Record<string, string> = { WEB_SITE: "파워링크", SHOPPING: "쇼핑검색", SHOPPING_PRODUCT: "쇼핑검색", BRAND_SEARCH: "브랜드검색광고", BRANDSEARCH: "브랜드검색광고" };
export const campaignTypeLabel = (t: unknown) => TYPE_LABEL[String(t ?? "").trim().toUpperCase()] || String(t ?? "").trim() || "기타";
export const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export function extractStat(d: unknown): Record<string, unknown> {
  const x = d as { data?: unknown } | unknown[] | null;
  if (x && !Array.isArray(x) && Array.isArray((x as { data?: unknown }).data)) return ((x as { data: Record<string, unknown>[] }).data[0]) || {};
  if (x && !Array.isArray(x) && (x as { data?: unknown }).data && typeof (x as { data?: unknown }).data === "object") return (x as { data: Record<string, unknown> }).data;
  if (Array.isArray(x)) return (x[0] as Record<string, unknown>) || {};
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}

