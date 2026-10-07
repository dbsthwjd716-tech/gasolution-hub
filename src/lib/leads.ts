// 인입 CRM 공통 규칙 (화면·서버·시험이 같은 규칙을 씀)

export const LEAD_STATUSES = ["연락 전", "연락 시도", "상담중", "제안/견적", "검토중", "계약완료", "계약실패", "보류", "종료", "스팸"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const SOURCES = ["네이버", "SNS_DB", "톡톡", "전화", "지인소개", "메일", "홈페이지", "기타"];
export const MEDIA = ["네이버", "메타", "구글", "쿠팡", "카카오", "기타"];
export const CONTACT_TYPES = ["전화", "문자", "카카오톡", "이메일", "미팅", "제안서", "기타"];

// 아직 진행 중인 문의 (연락 필요 여부를 따지는 상태)
export const OPEN_STATUSES: LeadStatus[] = ["연락 전", "연락 시도", "상담중", "제안/견적", "검토중"];

// 보드(파이프라인) 칸
export const BOARD: { label: string; statuses: LeadStatus[] }[] = [
  { label: "연락 전", statuses: ["연락 전", "연락 시도"] },
  { label: "상담중", statuses: ["상담중"] },
  { label: "제안·검토", statuses: ["제안/견적", "검토중"] },
  { label: "계약완료", statuses: ["계약완료"] },
  { label: "보류", statuses: ["보류"] },
  { label: "종료·실패", statuses: ["계약실패", "종료"] },
];

export const STATUS_CHIP: Record<LeadStatus, string> = {
  "연락 전": "chip-muted",
  "연락 시도": "chip-info",
  상담중: "chip-info",
  "제안/견적": "chip-info",
  검토중: "chip-info",
  계약완료: "chip-ok",
  계약실패: "chip-warn",
  보류: "chip-warn",
  종료: "chip-muted",
  스팸: "chip-muted",
};

// "2026년 10월 7일 화요일 14:30", "26.10.7 14:30", "2026-10-07 14:30" 등 → 한국 시간 ISO
export function parseInquiryAt(text: string): string | null {
  const t = text.trim().replace(/\.$/, "");
  let y: number, mo: number, d: number, h = 0, mi = 0;
  let m = t.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*\(?[월화수목금토일]요일\)?)?\s*(?:(오전|오후)\s*)?(\d{1,2})?(?::(\d{2}))?/);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[5]) h = Number(m[5]);
    if (m[6]) mi = Number(m[6]);
    if (m[4] === "오후" && h < 12) h += 12;
    if (m[4] === "오전" && h === 12) h = 0;
  } else {
    m = t.match(/^(\d{2}|\d{4})[./-]\s*(\d{1,2})[./-]\s*(\d{1,2})\.?(?:\s+|T)?(\d{1,2})?(?::(\d{2}))?/);
    if (!m) return null;
    y = Number(m[1].length === 2 ? "20" + m[1] : m[1]);
    [mo, d] = [Number(m[2]), Number(m[3])];
    if (m[4]) h = Number(m[4]);
    if (m[5]) mi = Number(m[5]);
  }
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00+09:00`;
}

const DAY = ["일", "월", "화", "수", "목", "금", "토"];

// ISO → "2026년 10월 7일 화요일 14:30" (한국 시간)
export function formatKST(iso: string | null | undefined, withDay = true) {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일${withDay ? ` ${DAY[d.getUTCDay()]}요일` : ""} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function kstDate(iso: string) {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

// 두 날짜(YYYY-MM-DD) 사이의 영업일 수 (주말 제외, 시작일 다음 날부터 셈)
export function businessDaysBetween(from: string, to: string) {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  let n = 0;
  for (let d = new Date(a.getTime() + 86400_000); d <= b; d = new Date(d.getTime() + 86400_000)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

export const FOLLOW_UP_DAYS = 3;

// 연락이 필요한 문의인가: 진행 중이고, (다음 연락일이 됐거나) 마지막 연락·문의 후 3영업일 지남
export function followUp(lead: { status: string; inquiry_at: string; last_contact_at: string | null; next_contact_on: string | null }, today: string) {
  if (!OPEN_STATUSES.includes(lead.status as LeadStatus)) return { needed: false, days: 0, reason: "" };
  const last = kstDate(lead.last_contact_at && lead.last_contact_at > lead.inquiry_at ? lead.last_contact_at : lead.inquiry_at);
  const days = businessDaysBetween(last, today);
  if (lead.next_contact_on) {
    return lead.next_contact_on <= today
      ? { needed: true, days, reason: `연락 예정일 ${lead.next_contact_on}` }
      : { needed: false, days, reason: "" };
  }
  return days >= FOLLOW_UP_DAYS ? { needed: true, days, reason: `${days}영업일째 연락 없음` } : { needed: false, days, reason: "" };
}

export function normalizeCompany(s: string) {
  return s.replace(/(주식회사|\(주\)|㈜)/g, "").replace(/[\s\-_.()[\]/·,]/g, "").toLowerCase();
}

export const phoneDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// 담당에게 보낼 문의 전달 문구 (메신저 붙여 넣기용)
export function forwardText(l: {
  source: string | null;
  inquiry_at: string;
  company_name: string;
  contact_name: string | null;
  monthly_budget: number | null;
  phone: string | null;
  media: string[];
  inquiry_content: string | null;
  memo: string | null;
  staff_name: string | null;
}) {
  const header = l.source === "SNS_DB" || l.media.includes("메타") ? "메타 양식 문의" : `${l.source ?? "신규"} 문의`;
  const lines = [
    header,
    "",
    `문의시간 : ${formatKST(l.inquiry_at)}`,
    `업체명 : ${l.company_name}`,
    `담당자 : ${l.contact_name ?? ""}`,
    `예산 : ${l.monthly_budget != null ? l.monthly_budget.toLocaleString("ko-KR") : ""}`,
    `연락처 : ${l.phone ?? ""}`,
    l.source ? `지에이솔루션을 알게된 경로 : ${l.source}` : null,
    l.media.length ? `광고 매체 : ${l.media.join(", ")}` : null,
    `문의 내용 : ${l.inquiry_content ?? ""}`,
    l.memo ? `비고 : ${l.memo}` : null,
    "",
    `@${l.staff_name ?? "담당자"} 확인 부탁드립니다.`,
  ];
  return lines.filter((x) => x !== null).join("\n");
}
