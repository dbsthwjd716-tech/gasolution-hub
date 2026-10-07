// 급여·인센티브 계산 (9월 급여 시트와 같은 규칙)
//   금액은 모두 VAT 별도. 각 줄은 원 미만 버림.

export type Track = "lead" | "sales_ae" | "nonsales_ae";
export const TRACK_LABEL: Record<Track, string> = { lead: "팀장", sales_ae: "영업 AE", nonsales_ae: "비영업 AE" };

export type Profile = {
  staff_id: string;
  track: Track;
  base_pay: number; // 기본급 (팀장은 직책수당 포함)
  cert_allowance: number; // 자격증 수당
  probation: boolean; // 수습: 기본급 90%
  rank_allowance: boolean; // 직급수당 받음
  viral_in_spend: boolean; // 바이럴 판매가를 마감 소진액에 합산 (비영업 AE)
  other_in_spend: boolean; // 네이버 외 매체 소진액을 마감 소진액에 합산
  viral_rate: number; // 바이럴 판매가 × (마감 소진액에 합산하지 않을 때)
  derived_rate: number; // 파생 바이럴 판매가 × (예: 서진원 4%)
  closing_rate: number; // 팀장 마감 매출 × 1.5%
  team_rate: number; // 팀장 팀 수당: 팀원 네이버 소진액 × 0.1%
  markup_rate: number; // 메타·구글 마크업 수수료(VAT 별도) × 20%
  coupang_rate: number; // 쿠팡 마크업 × 20%
  other_media_rate: number; // (본인 + 팀장) 네이버 외 매체 소진액 × 0.2% (매니저)
};

export type Tier = { kind: "sales_ae" | "nonsales_ae" | "rank"; min_spend: number; rate: number | null; rank_name: string | null; amount: number | null };

export type Inputs = {
  naver_spend: number; // 본인 네이버 소진액
  handover_spend: number; // 인계받은 계정 소진액 (마감 소진액에 100%, 직급수당·팀 수당에는 제외)
  other_spend: number; // 네이버 외 매체 소진액
  markup_fee: number; // 메타·구글 마크업 수수료 (VAT 포함, 받은 금액)
  coupang_fee: number; // 쿠팡 마크업 수수료 기준 금액
  unpaid_markup_fee: number; // 받지 못한 마크업 수수료 → 50% 차감
};
export const EMPTY_INPUTS: Inputs = { naver_spend: 0, handover_spend: 0, other_spend: 0, markup_fee: 0, coupang_fee: 0, unpaid_markup_fee: 0 };

export type Auto = {
  viral_sales: number; // 본인 담당 바이럴 판매가 (인센티브 제외 상품 빼고)
  derived_sales: number; // 내가 파생 실적자인 바이럴 판매가
  team_naver: number; // 팀장 팀 수당 기준: 다른 팀원 네이버 소진액 합
  lead_other_spend: number; // 팀장의 네이버 외 매체 소진액 (매니저 0.2% 기준)
  team_bonus: number; // 팀 목표 달성 시 1인 지급액 (미달이면 0)
};
export const EMPTY_AUTO: Auto = { viral_sales: 0, derived_sales: 0, team_naver: 0, lead_other_spend: 0, team_bonus: 0 };

export type Extra = { label: string; amount: number };
export type Line = { key: string; label: string; amount: number; note?: string };

const floor = (n: number) => Math.floor(n + 1e-6);
const pct = (r: number) => `${+(r * 100).toFixed(2)}%`;
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

// 표에서 소진액 이하 중 가장 큰 구간 (엑셀 VLOOKUP 근사 일치와 같음). 가장 낮은 구간보다 적으면 없음
export function pickTier(tiers: Tier[], kind: Tier["kind"], spend: number) {
  let best: Tier | null = null;
  for (const t of tiers) if (t.kind === kind && spend >= t.min_spend && (!best || t.min_spend > best.min_spend)) best = t;
  return best;
}

export function closingSpend(p: Profile, i: Inputs, a: Auto) {
  return (
    i.naver_spend + i.handover_spend +
    (p.other_in_spend ? i.other_spend : 0) +
    (p.viral_in_spend ? a.viral_sales : 0)
  );
}

// 직급수당 기준: 인계 계정 빼고 본인 실적
export function rankSpend(p: Profile, i: Inputs, a: Auto) {
  return i.naver_spend + (p.other_in_spend ? i.other_spend : 0) + (p.viral_in_spend ? a.viral_sales : 0);
}

export function calcPay(p: Profile, i: Inputs, a: Auto, tiers: Tier[], extras: Extra[] = []) {
  const lines: Line[] = [];
  const add = (key: string, label: string, amount: number, note?: string) => {
    const v = floor(amount);
    if (v !== 0 || key === "base") lines.push({ key, label, amount: v, note });
  };
  const spend = closingSpend(p, i, a);

  add("base", p.track === "lead" ? "기본급 + 직책수당" : "기본급", p.probation ? p.base_pay * 0.9 : p.base_pay, p.probation ? "수습 90%" : undefined);
  if (p.cert_allowance) add("cert", "자격증 수당", p.cert_allowance);

  if (p.track === "lead") {
    add("closing", `마감 매출 ${pct(p.closing_rate)}`, spend * p.closing_rate, `마감 소진액 ${won(spend)}원`);
    add("team", `팀 수당 ${pct(p.team_rate)}`, a.team_naver * p.team_rate, `팀원 네이버 소진액 ${won(a.team_naver)}원`);
  } else {
    const tier = pickTier(tiers, p.track, spend);
    const rate = tier?.rate ?? 0;
    add("closing", "마감 인센티브", spend * 0.13 * rate, `마감 소진액 ${won(spend)}원 × 13% × ${pct(rate)}${tier ? "" : " (구간 미달)"}`);
    if (p.rank_allowance) {
      const rs = rankSpend(p, i, a);
      const r = pickTier(tiers, "rank", rs);
      if (r) add("rank", `직급수당 (${r.rank_name})`, r.amount ?? 0, `기준 ${won(rs)}원`);
    }
  }
  if (!p.viral_in_spend && p.viral_rate && a.viral_sales) add("viral", `바이럴 ${pct(p.viral_rate)}`, a.viral_sales * p.viral_rate, `판매가 ${won(a.viral_sales)}원`);
  if (p.derived_rate && a.derived_sales) add("derived", `파생 바이럴 ${pct(p.derived_rate)}`, a.derived_sales * p.derived_rate, `판매가 ${won(a.derived_sales)}원`);
  if (p.markup_rate && i.markup_fee) add("markup", `메타·구글 마크업 ${pct(p.markup_rate)}`, (i.markup_fee / 1.1) * p.markup_rate, `수수료 ${won(i.markup_fee)}원(VAT 포함) ÷ 1.1`);
  if (p.other_media_rate) {
    const base = i.other_spend + a.lead_other_spend;
    if (base) add("other_media", `네이버 외 매체 ${pct(p.other_media_rate)}`, base * p.other_media_rate, `본인 ${won(i.other_spend)} + 팀장 ${won(a.lead_other_spend)}원`);
  }
  if (p.coupang_rate && i.coupang_fee) add("coupang", `쿠팡 ${pct(p.coupang_rate)}`, i.coupang_fee * p.coupang_rate);
  if (a.team_bonus) add("team_bonus", "팀 목표 달성", a.team_bonus);
  if (i.unpaid_markup_fee) add("unpaid", "마크업 미입금 차감 50%", -i.unpaid_markup_fee * 0.5, `미입금 ${won(i.unpaid_markup_fee)}원`);
  for (const e of extras) if (e.label && e.amount) add("extra", e.label, e.amount);

  const total = lines.reduce((t, l) => t + l.amount, 0);
  return { spend, lines, total };
}

// 그 달 팀 전체 계산에 필요한 값: 팀 수당·매니저 0.2%·팀 목표
export function teamAuto(rows: { profile: Profile; inputs: Inputs }[], teamGoal: number, teamBonus: number) {
  const lead = rows.find((r) => r.profile.track === "lead");
  const teamNaver = rows.filter((r) => r.profile.track !== "lead").reduce((t, r) => t + r.inputs.naver_spend, 0);
  return {
    teamNaver,
    leadOther: lead?.inputs.other_spend ?? 0,
    achieved: teamGoal > 0 && teamNaver >= teamGoal,
    bonus: teamGoal > 0 && teamNaver >= teamGoal ? teamBonus : 0,
  };
}

export function readInputs(v: unknown): Inputs {
  const o = (v ?? {}) as Record<string, unknown>;
  const n = (k: string) => (Number.isFinite(Number(o[k])) ? Number(o[k]) : 0);
  return { naver_spend: n("naver_spend"), handover_spend: n("handover_spend") + n("handover_new_spend") /* 예전 '인계 첫 달' 값도 100%로 합침 */, other_spend: n("other_spend"), markup_fee: n("markup_fee"), coupang_fee: n("coupang_fee"), unpaid_markup_fee: n("unpaid_markup_fee") };
}

export function readExtras(v: unknown): Extra[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e) => e && typeof e.label === "string").map((e) => ({ label: String(e.label).slice(0, 60), amount: Number(e.amount) || 0 }));
}
