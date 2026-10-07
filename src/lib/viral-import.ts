// 구글 시트 '바이럴 견적 및 세금계산서 요청'의 협력사 탭(제이솔·풀림·포에스·애드매니저)을
// 새 시스템으로 옮기기 위한 정리 계획을 만든다. 데이터베이스에는 아무것도 쓰지 않고,
// "어떤 거래처를 만들고 어떤 건을 어느 거래처에 붙일지 + 사람이 확인할 문제"만 계산한다.
//
// 시트 칸 순서 (2행부터 데이터):
//   A 번호 | B 시작날짜(입금날짜) | C 기간·내용 | D 업체명 | E 대표자 | F 사업자번호 | G 주소
//   H 세금계산서 발행메일 | I 사업자등록증 첨부 | J 공급가(협력사 견적, VAT 포함) | K 판매가(VAT 별도)
//   L 담당자 | M 입금여부 | N 세금계산서발행여부 | O 협력사결제여부 | P 협력사에 입금한 금액
//   Q 협력사 세금계산서 발행금액
// 탭에 따라 칸이 한 칸 밀린 경우가 있어서, 날짜 칸 위치를 기준으로 나머지 칸을 찾는다.

import { isValidBizNo, normalizeBizNo } from "./bizno.ts";

export const PARTNER_TABS = ["제이솔", "풀림", "포에스", "애드매니저"] as const;

export type ProblemKind =
  | "missing_date"
  | "missing_company"
  | "missing_amount"
  | "missing_manager"
  | "invalid_bizno"
  | "bizno_conflict"
  | "column_shift"
  | "cost_over_sale"
  | "unpaid"
  | "no_sale_amount"
  | "negative_amount";

export type Problem = { tab: string; row: number; kind: ProblemKind; message: string };

export type PlannedOrder = {
  tab: string;
  row: number;
  clientKey: string;
  paidDate: string | null; // 입금 전이면 없음
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  saleAmount: number;
  costAmount: number;
  manager: string;
  saleNote: string | null; // 판매가 칸에 적혀 있던 설명
  managerLabel: string | null; // 시트에 적힌 담당자 표기가 이름과 다를 때 (예: "남지윤(파생)")
  paymentReceived: boolean;
  paymentNote: string | null;
  invoiceIssued: boolean;
  partnerPaid: boolean;
  partnerPaidAmount: number | null;
  partnerInvoiceAmount: number | null;
};

export type PlannedClient = {
  key: string; // "bn:1234567890" 또는 "name:정규화된이름"
  businessNumber: string | null;
  companyName: string;
  otherNames: string[];
  representativeName: string | null;
  address: string | null;
  billingEmails: string[];
  hasRegistration: boolean;
  orderCount: number;
};

export type ImportPlan = {
  clients: PlannedClient[];
  orders: PlannedOrder[];
  skipped: Problem[]; // 옮기지 못한 줄
  warnings: Problem[]; // 옮기되 확인이 필요한 줄
  totals: { rows: number; orders: number; saleAmount: number; costAmount: number };
};

// ------------------------------------------------------------------ 칸 값 정리

export function parseDate(v: unknown): string | null {
  const m = String(v ?? "").trim().match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\.?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== mo || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseAmount(v: unknown): number | null {
  const t = String(v ?? "").replace(/[,원\s]/g, "");
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t));
}

function text(v: unknown): string | null {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
}

const YES = /^(o|ㅇ|y|yes|v|완료|발행|입금|결제|true)$/i;
function yes(v: unknown): boolean {
  const t = String(v ?? "").trim();
  return YES.test(t);
}

// 담당자 칸에 "서진원 " 처럼 공백이나 추가 글자가 붙은 경우 정리 (예전 시트 연동과 같은 규칙)
export function normalizeManager(v: unknown, known: string[] = []): string | null {
  const t = text(v);
  if (!t) return null;
  // 여러 이름이 들어 있으면(예: "박영서(파생서진원)") 맨 앞에 적힌 사람이 담당
  const hits = known.filter((k) => t.includes(k)).sort((a, b) => t.indexOf(a) - t.indexOf(b));
  return hits[0] ?? t;
}

export function normalizeName(v: string): string {
  return v
    .replace(/(주식회사|\(주\)|㈜)/g, "")
    .replace(/[\s\-_.()[\]/·,]/g, "")
    .toLowerCase();
}

function splitEmails(v: unknown): string[] {
  return String(v ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

// 날짜 칸에 "입금전", "미입금" 처럼 적힌 경우
export function isUnpaidMarker(v: unknown): boolean {
  return /(입금\s*전|미\s*입금|입금\s*예정|입금\s*대기)/.test(String(v ?? ""));
}

// 기간·내용 칸에서 진행 시작일과 끝나는 날을 꺼냄. 예: "25.11.05~25.11.14(10일)", "2025. 11. 21~ 플레이스 최적화"
export function parsePeriod(v: unknown): { start: string | null; end: string | null } {
  const t = String(v ?? "");
  const re = /(\d{2}|\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/g;
  const found: string[] = [];
  for (const m of t.matchAll(re)) {
    const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    const d = parseDate(`${y}.${m[2]}.${m[3]}`);
    if (d) found.push(d);
    if (found.length === 2) break;
  }
  const [start = null, end = null] = found;
  return { start, end: end && start && end >= start ? end : null };
}

// ------------------------------------------------------------------ 한 줄 읽기

type RawRow = {
  tab: string;
  row: number;
  shifted: number; // 0이면 정상, 1이면 한 칸 오른쪽으로 밀림, -1이면 왼쪽
  paidDate: string | null;
  unpaid: boolean; // 날짜 칸에 "입금전" 등
  saleRaw: string | null;
  saleNote?: string | null;
  description: string | null;
  company: string | null;
  representative: string | null;
  bizRaw: string | null;
  address: string | null;
  emails: string[];
  hasRegistration: boolean;
  cost: number | null;
  sale: number | null;
  manager: string | null;
  managerRaw: string | null;
  paymentNote: string | null;
  invoiceIssued: boolean;
  partnerPaid: boolean;
  partnerPaidAmount: number | null;
  partnerInvoiceAmount: number | null;
};

// 한 줄을 읽는 방법(칸 배치)을 몇 가지로 시도해 보고, 담당자·사업자번호·메일·금액이 가장 그럴듯하게
// 제자리에 오는 배치를 고른다. 탭마다 날짜 앞이나 뒤에 칸이 하나 더 있는 경우가 있어서.
//   dateCol: 날짜 칸 위치 (원래 B=1)
//   bodyShift: 날짜 다음부터 칸이 몇 칸 밀렸는지 (애드매니저처럼 날짜 뒤에 칸이 하나 더 있으면 1)
function layoutScore(cells: unknown[], dateCol: number, bodyShift: number, managers: string[]) {
  const at = (k: number) => cells[dateCol + k + (k >= 1 ? bodyShift : 0)];
  let score = 0;
  const date = at(0);
  if (parseDate(date)) score += 2;
  else if (!text(date) || isUnpaidMarker(date)) score += 1;
  const mgr = text(at(10));
  if (mgr && managers.some((m) => mgr.includes(m))) score += 4;
  else if (mgr && /^[가-힣]{2,4}(\(.+\))?$/.test(mgr)) score += 2; // 사람 이름 모양
  if (mgr && parseAmount(mgr) !== null) score -= 3; // 담당자 자리에 금액이 오면 잘못된 배치
  const bn = normalizeBizNo(text(at(4)));
  if (bn && isValidBizNo(bn)) score += 2;
  if (splitEmails(at(6)).length) score += 1;
  if (parseAmount(at(9)) !== null) score += 1;
  if (text(at(2)) && parseAmount(at(2)) === null) score += 0.5; // 업체명은 숫자가 아님
  return score;
}

function readRow(tab: string, row: number, cells: unknown[], managers: string[]): RawRow | null {
  if (!cells.some((c) => text(c))) return null; // 빈 줄

  // 기본 배치(날짜 B, 밀림 없음)를 먼저 두고, 다른 배치가 확실히 더 나을 때만 바꿈
  const candidates: [number, number][] = [[1, 0], [2, 0], [0, 0], [1, 1], [1, -1]];
  let best = candidates[0];
  let bestScore = layoutScore(cells, 1, 0, managers);
  for (const [d, b] of candidates.slice(1)) {
    const sc = layoutScore(cells, d, b, managers);
    if (sc > bestScore + 0.5) {
      best = [d, b];
      bestScore = sc;
    }
  }
  const [dateCol, bodyShift] = best;
  const at = (k: number) => cells[dateCol + k + (k >= 1 ? bodyShift : 0)];
  const dateCell = at(0);
  // 날짜 뒤에 칸이 하나 더 있던 경우, 그 칸(예: "6/15") 내용은 기간·내용 앞에 붙여 둠
  const extra = bodyShift > 0 ? text(cells[dateCol + 1]) : null;
  const desc = [extra, text(at(1))].filter(Boolean).join(" ") || null;

  return {
    tab,
    row,
    shifted: dateCol - 1 + bodyShift,
    paidDate: parseDate(dateCell),
    unpaid: !parseDate(dateCell) && (!text(dateCell) || isUnpaidMarker(dateCell)),
    saleRaw: text(at(9)),
    description: desc,
    company: text(at(2)),
    representative: text(at(3)),
    bizRaw: text(at(4)),
    address: text(at(5)),
    emails: splitEmails(at(6)),
    hasRegistration: yes(at(7)),
    cost: parseAmount(at(8)),
    sale: parseAmount(at(9)),
    manager: normalizeManager(at(10), managers),
    managerRaw: text(at(10)),
    paymentNote: text(at(11)),
    invoiceIssued: yes(at(12)),
    partnerPaid: yes(at(13)),
    partnerPaidAmount: parseAmount(at(14)),
    partnerInvoiceAmount: parseAmount(at(15)),
  };
}

// ------------------------------------------------------------------ 전체 계획

export function planViralImport(
  tabs: Record<string, unknown[][]>, // 탭 이름 → 2행부터의 줄 목록
  opts: { managers?: string[] } = {},
): ImportPlan {
  const managers = opts.managers ?? [];
  const skipped: Problem[] = [];
  const warnings: Problem[] = [];
  const rows: RawRow[] = [];
  let rowCount = 0;

  for (const [tab, lines] of Object.entries(tabs)) {
    lines.forEach((cells, i) => {
      const r = readRow(tab, i + 2, cells ?? [], managers);
      if (!r) return;
      rowCount++;
      const skip = (kind: ProblemKind, message: string) => skipped.push({ tab, row: r.row, kind, message });
      if (!r.paidDate && !r.unpaid) return skip("missing_date", "입금날짜를 읽을 수 없습니다");
      if (!r.company) return skip("missing_company", "업체명이 없습니다");
      // 판매가 칸에 숫자 없이 설명만 있으면(예: "서비스 대응") 0원 서비스 건으로, 설명은 메모로
      const saleNote = r.sale === null && r.saleRaw && !/\d/.test(r.saleRaw) ? r.saleRaw : null;
      if (r.sale === null && r.saleRaw && !saleNote) return skip("missing_amount", `판매가 '${r.saleRaw}'를 숫자로 읽을 수 없습니다`);
      r.saleNote = saleNote;
      if (!r.manager) return skip("missing_manager", "담당자가 없습니다");
      if (r.unpaid) warnings.push({ tab, row: r.row, kind: "unpaid", message: "입금날짜가 비어 있거나 '입금전'이라 입금 전 건으로 옮깁니다" });
      if (r.sale === null) {
        r.sale = 0;
        warnings.push({
          tab,
          row: r.row,
          kind: "no_sale_amount",
          message: saleNote ? `판매가 칸에 '${saleNote}'라고 적혀 있어 0원 서비스 건으로 옮기고 내용은 메모에 남깁니다` : "판매가가 비어 있어 0원으로 옮깁니다 (서비스 건)",
        });
      }
      if (r.sale < 0 || (r.cost ?? 0) < 0)
        warnings.push({ tab, row: r.row, kind: "negative_amount", message: "마이너스 금액입니다 (환불·취소 건으로 보임). 그대로 옮깁니다" });
      if (r.shifted !== 0)
        warnings.push({ tab, row: r.row, kind: "column_shift", message: "칸 배치가 다른 줄과 달라(한 칸 밀림) 담당자·사업자번호 위치에 맞춰 읽었습니다" });
      rows.push(r);
    });
  }

  // 업체명별로 사업자번호 후보를 모음. 같은 업체에 번호가 여러 개면(시트를 끌어 채우다 끝자리가 1씩 늘어난 경우 등)
  // 검증을 통과하는 번호를 쓰고 나머지 줄은 확인 대상으로 남김
  const byName = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const bn = normalizeBizNo(r.bizRaw);
    if (!bn || !isValidBizNo(bn)) continue;
    const k = normalizeName(r.company!);
    const m = byName.get(k) ?? new Map<string, number>();
    m.set(bn, (m.get(bn) ?? 0) + 1);
    byName.set(k, m);
  }
  const bestBizForName = (name: string): string | null => {
    const m = byName.get(normalizeName(name));
    if (!m) return null;
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const clients = new Map<string, PlannedClient>();
  const orders: PlannedOrder[] = [];

  for (const r of rows) {
    const raw = normalizeBizNo(r.bizRaw);
    let bn: string | null = raw && isValidBizNo(raw) ? raw : null;
    if (raw && !bn) {
      const fallback = bestBizForName(r.company!);
      warnings.push({
        tab: r.tab,
        row: r.row,
        kind: "invalid_bizno",
        message: fallback
          ? `사업자번호 ${r.bizRaw}가 맞지 않아, 같은 업체의 다른 줄에 있는 번호로 연결했습니다`
          : `사업자번호 ${r.bizRaw}가 맞지 않아 사업자번호 없이(임시 거래처) 옮깁니다`,
      });
      bn = fallback;
    }
    const nameKey = normalizeName(r.company!);
    const key = bn ? `bn:${bn}` : `name:${nameKey}`;

    const c = clients.get(key) ?? {
      key,
      businessNumber: bn,
      companyName: r.company!,
      otherNames: [],
      representativeName: null,
      address: null,
      billingEmails: [],
      hasRegistration: false,
      orderCount: 0,
    };
    // 가장 최근 줄의 정보가 최신이라고 보고 덮어씀 (시트는 위에서 아래로 날짜순)
    if (normalizeName(c.companyName) !== nameKey && !c.otherNames.some((n) => normalizeName(n) === nameKey))
      c.otherNames.push(r.company!);
    c.representativeName = r.representative ?? c.representativeName;
    c.address = r.address ?? c.address;
    for (const e of r.emails) if (!c.billingEmails.includes(e)) c.billingEmails.push(e);
    c.hasRegistration ||= r.hasRegistration;
    c.orderCount++;
    clients.set(key, c);

    // 공급가는 VAT 포함, 판매가는 VAT 별도 → 공급가에서 VAT를 뺀 금액과 비교
    if (r.cost !== null && r.sale !== null && Math.round(r.cost / 1.1) > r.sale)
      warnings.push({ tab: r.tab, row: r.row, kind: "cost_over_sale", message: "공급가(VAT 별도로 환산)가 판매가보다 큽니다 (마진 마이너스)" });

    orders.push({
      tab: r.tab,
      row: r.row,
      clientKey: key,
      paidDate: r.paidDate,
      ...(() => {
        const p = parsePeriod(r.description);
        return { startDate: p.start, endDate: p.end };
      })(),
      description: r.description,
      saleAmount: r.sale!,
      costAmount: r.cost ?? 0,
      manager: r.manager!,
      saleNote: r.saleNote ?? null,
      managerLabel: r.managerRaw && r.managerRaw !== r.manager ? r.managerRaw : null,
      paymentReceived: !r.unpaid && !!r.paymentNote && /입금|^o$/i.test(r.paymentNote),
      paymentNote: r.paymentNote,
      invoiceIssued: r.invoiceIssued,
      partnerPaid: r.partnerPaid,
      partnerPaidAmount: r.partnerPaidAmount,
      partnerInvoiceAmount: r.partnerInvoiceAmount,
    });
  }

  // 사업자번호가 다른데 이름이 같은 거래처 → 같은 회사인지 사람이 확인
  const namesByBn = new Map<string, string[]>();
  for (const c of clients.values()) {
    if (!c.businessNumber) continue;
    const k = normalizeName(c.companyName);
    namesByBn.set(k, [...(namesByBn.get(k) ?? []), c.businessNumber]);
  }
  for (const [name, bns] of namesByBn) {
    if (bns.length > 1) {
      const first = orders.find((o) => normalizeName(clients.get(o.clientKey)!.companyName) === name)!;
      warnings.push({
        tab: first.tab,
        row: first.row,
        kind: "bizno_conflict",
        message: `같은 업체명에 서로 다른 올바른 사업자번호가 ${bns.length}개 있습니다. 같은 회사인지 확인해 주세요`,
      });
    }
  }

  return {
    clients: [...clients.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, "ko")),
    orders,
    skipped,
    warnings,
    totals: {
      rows: rowCount,
      orders: orders.length,
      saleAmount: orders.reduce((s, o) => s + o.saleAmount, 0),
      costAmount: orders.reduce((s, o) => s + o.costAmount, 0),
    },
  };
}

// ------------------------------------------------------------------ 묶음 만들기
// 같은 협력사 탭·같은 거래처·같은 입금일·같은 담당(파생 여부 포함)인 줄들을 바이럴 1건으로 묶는다.
// 입금 전(입금일 없음) 줄은 묶지 않고 줄마다 1건.

export type PlannedGroup = {
  key: string; // 다시 옮겨도 같은 건으로 덮어쓰기 위한 고유 키
  tab: string;
  clientKey: string;
  paidDate: string | null;
  manager: string;
  derived: boolean; // 담당 표기에 "파생"이 있음
  managerLabels: string[];
  paymentReceived: boolean;
  paymentNotes: string[];
  invoiceIssued: boolean;
  partnerPaid: boolean;
  partnerPaidAmount: number | null;
  partnerInvoiceAmount: number | null;
  saleNotes: string[];
  items: PlannedOrder[];
};

const sumOrNull = (xs: (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null);
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export function groupOrders(orders: PlannedOrder[]): PlannedGroup[] {
  const map = new Map<string, PlannedOrder[]>();
  for (const o of orders) {
    const derived = /파생/.test(o.managerLabel ?? "");
    const key = ["sheet", o.tab, o.clientKey, o.paidDate ?? `unpaid-row${o.row}`, o.manager, derived ? "derived" : ""].join("|");
    map.set(key, [...(map.get(key) ?? []), o]);
  }
  return [...map.entries()].map(([key, items]) => {
    const f = items[0];
    return {
      key,
      tab: f.tab,
      clientKey: f.clientKey,
      paidDate: f.paidDate,
      manager: f.manager,
      derived: /파생/.test(f.managerLabel ?? ""),
      managerLabels: uniq(items.map((i) => i.managerLabel)),
      paymentReceived: items.every((i) => i.paymentReceived),
      paymentNotes: uniq(items.map((i) => i.paymentNote)),
      invoiceIssued: items.every((i) => i.invoiceIssued),
      partnerPaid: items.every((i) => i.partnerPaid),
      partnerPaidAmount: sumOrNull(items.map((i) => i.partnerPaidAmount)),
      partnerInvoiceAmount: sumOrNull(items.map((i) => i.partnerInvoiceAmount)),
      saleNotes: uniq(items.map((i) => i.saleNote)),
      items,
    };
  });
}
