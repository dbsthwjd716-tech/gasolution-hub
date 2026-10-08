// 월간 목표 프로모션 판정 (예전 'GA Solution 프로모션 체커'와 같은 규칙)
//   팀 목표: '팀 산정 포함' 인원의 (팀 산정액, 없으면 마감액) 합계가 팀 목표 이상이면 1인당 팀 인센티브
//   개인 목표: 마감액 ≥ 개인 목표
//   상승분: 전월 대비 500만원(구간) 오를 때마다 구간 인센티브 '후보' → 다음 달에도 전월 마감 이상 유지하면 확정
//   지급(마감 확정 달) = 기존 상승분 유지 인센티브 + 팀 인센티브. 지급 제외 인원은 0원

export type PromoConfig = { bandSize: number; bandReward: number; teamReward: number; partial: boolean; goalStep: number; truncUnit: number };
export const DEFAULT_CONFIG: PromoConfig = { bandSize: 5_000_000, bandReward: 50_000, teamReward: 100_000, partial: false, goalStep: 5_000_000, truncUnit: 1_000_000 };

export type PromoMember = {
  name: string;
  target: number | null;
  actual: number | null;
  inTeam: boolean;
  teamAmount: number | null;
  leader: boolean;
  excluded: boolean;
  note: string;
  targetKind?: "auto" | "carry" | "manual" | null;
};
export type PromoMonth = { month: string; teamTarget: number | null; teamKind?: "sum" | "manual" | null; closed: boolean; memo: string; members: PromoMember[] };

export type Status = "ok" | "bad" | "prog" | "wait" | "na";
export type KeepStatus = "ok" | "part" | "bad" | "none" | "na" | "wait";

export type MemberResult = PromoMember & {
  prev: number | null;
  prev2: number | null;
  rate: number | null;
  pending: boolean;
  goal: Status;
  delta: number | null;
  newBands: number | null;
  newAmt: number | null;
  nextLine: number | null;
  keep: KeepStatus;
  keepWhy: string;
  prevBands: number | null;
  keptBands: number | null;
  keepAmt: number;
  keepPot: number;
  teamAmt: number;
  pay: number;
};
export type TeamResult = { target: number | null; actual: number | null; targetSum: number | null; rate: number | null; gap: number | null; missing: number; count: number; status: Status };
export type MonthResult = { month: string; prevMonth: string; closed: boolean; team: TeamResult; rows: MemberResult[]; memo: string };

export const shiftMonth = (ym: string, d: number) => {
  const [y, m] = ym.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const monthLabel = (ym: string) => `${Number(ym.slice(5, 7))}월`;
export const monthFull = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const won = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`);
const pct = (a: number | null, b: number | null) => (a == null || !b ? null : (a / b) * 100);

function actualOf(months: Record<string, PromoMonth>, ym: string, name: string) {
  const r = months[ym]?.members.find((x) => x.name === name);
  return r && r.actual != null ? r.actual : null;
}

export function teamSum(members: PromoMember[]) {
  const ms = members.filter((m) => m.inTeam && m.target != null);
  return ms.length ? ms.reduce((s, m) => s + (m.target ?? 0), 0) : null;
}

export function computeMonth(months: Record<string, PromoMonth>, ym: string, cfg: PromoConfig): MonthResult | null {
  const M = months[ym];
  if (!M) return null;
  const { bandSize: B, bandReward: R, teamReward: TR, partial } = cfg;
  const pk = shiftMonth(ym, -1), p2k = shiftMonth(ym, -2);
  const closed = M.closed;
  const tm = M.members.filter((m) => m.inTeam);
  const vals = tm.map((m) => (m.teamAmount != null ? m.teamAmount : m.actual));
  const team: TeamResult = {
    target: M.teamTarget,
    count: tm.length,
    missing: vals.filter((v) => v == null).length,
    actual: vals.some((v) => v != null) ? vals.reduce<number>((s, v) => s + (v ?? 0), 0) : null,
    targetSum: tm.some((m) => m.target != null) ? tm.reduce((s, m) => s + (m.target ?? 0), 0) : null,
    rate: null,
    gap: null,
    status: "na",
  };
  team.rate = pct(team.actual, team.target);
  team.gap = team.target != null && team.actual != null ? team.actual - team.target : null;
  team.status = team.target == null ? "na" : team.actual == null ? "wait" : !closed ? "prog" : team.actual >= team.target ? "ok" : "bad";

  const rows = M.members.map((mem): MemberResult => {
    const a = mem.actual, t = mem.target, p = actualOf(months, pk, mem.name), p2 = actualOf(months, p2k, mem.name);
    const r: MemberResult = {
      ...mem, prev: p, prev2: p2, rate: pct(a, t), pending: a == null,
      goal: t == null ? "na" : a == null ? "wait" : closed ? (a >= t ? "ok" : "bad") : "prog",
      nextLine: p != null ? p + B : null, delta: null, newBands: null, newAmt: null,
      keep: "na", keepWhy: "", prevBands: null, keptBands: null, keepAmt: 0, keepPot: 0, teamAmt: 0, pay: 0,
    };
    if (a != null && p != null) {
      r.delta = a - p;
      r.newBands = r.delta > 0 ? Math.floor(r.delta / B) : 0;
      r.newAmt = r.newBands * R;
    }
    if (p == null || p2 == null) {
      r.keepWhy = p == null ? "전월 마감 없음" : "전전월 마감 없음";
    } else {
      const rise = p - p2;
      r.prevBands = rise > 0 ? Math.floor(rise / B) : 0;
      if (r.prevBands === 0) {
        r.keep = "none";
        r.keepWhy = rise > 0 ? "전월 상승 500만원 미만" : "전월 실적 감소";
      } else if (a == null) {
        r.keep = "wait";
        r.keepPot = r.prevBands * R;
        r.keepWhy = partial ? `${won(p2 + B)} 이상부터 구간별 인정, ${won(p)} 이상이면 전부` : `${monthLabel(ym)} 마감 ${won(p)} 이상이면 인정`;
      } else {
        const kept = partial ? Math.max(0, Math.min(r.prevBands, Math.floor((a - p2) / B))) : a >= p ? r.prevBands : 0;
        r.keptBands = kept;
        r.keepAmt = kept * R;
        r.keep = kept === r.prevBands ? "ok" : kept > 0 ? "part" : "bad";
        r.keepWhy = r.keep === "ok" ? `${monthLabel(pk)} 수준 유지` : r.keep === "part" ? `${r.prevBands}구간 중 ${kept}구간 유지` : `${monthLabel(pk)} 마감 ${won(p)} 미유지`;
      }
    }
    r.teamAmt = team.status === "ok" ? TR : 0;
    r.pay = mem.excluded ? 0 : r.keepAmt + r.teamAmt;
    return r;
  });
  return { month: ym, prevMonth: pk, closed, team, rows, memo: M.memo };
}

// 다음 달 자동 목표: 전월 마감 확정 기준
//   달성(또는 목표 없음): 전월 마감 + 상승폭 → 절삭 단위로 내림 / 미달성: 기존 목표 유지
export function autoTargets(months: Record<string, PromoMonth>, ym: string, cfg: PromoConfig) {
  const P = months[shiftMonth(ym, -1)];
  const out = { ready: !!P?.closed, members: {} as Record<string, { target: number; kind: "auto" | "carry" }> };
  if (!out.ready || !P) return out;
  for (const m of P.members) {
    const a = m.actual, t = m.target;
    if (a == null) {
      if (t != null) out.members[m.name] = { target: t, kind: "carry" };
    } else if (t != null && a < t) out.members[m.name] = { target: t, kind: "carry" };
    else out.members[m.name] = { target: Math.floor((a + cfg.goalStep) / cfg.truncUnit) * cfg.truncUnit, kind: "auto" };
  }
  return out;
}

const plus = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(Math.round(n)).toLocaleString("ko-KR")}원`;

// 팀원 공지 (팀장 실적은 항상 뺌)
export function goalNotice(c: MonthResult) {
  const M = monthLabel(c.month), P = monthLabel(c.prevMonth);
  const L: string[] = [`[${M} 개인 목표]`, ""];
  for (const r of c.rows.filter((x) => !x.leader)) {
    L.push(`▶ ${r.name}`, `${P} 마감: ${won(r.prev)}`, `${M} 목표: ${won(r.target)}`, `목표까지: ${r.prev != null && r.target != null ? plus(r.target - r.prev) : "—"}`, "");
  }
  L.push(`[${M} 팀 목표]`, "", `▶ ${M} 팀 목표: ${won(c.team.target)}`);
  return L.join("\n").trim();
}

export function resultNotice(c: MonthResult, cfg: PromoConfig) {
  const t = c.team, M = monthLabel(c.month), P = monthLabel(c.prevMonth), P2 = monthLabel(shiftMonth(c.month, -2)), N = monthLabel(shiftMonth(c.month, 1));
  const rows = c.rows.filter((x) => !x.leader);
  const L: string[] = [`[${M} 프로모션 결과 안내]`, `${M} 개인 및 팀 마감에 따른 프로모션 결과 공유드립니다.`, ""];
  L.push(`[${M} 팀 목표 결과]`, `▶ ${M} 팀 목표: ${won(t.target)}`, `▶ ${M} 팀 마감: ${won(t.actual)}`, `▶ 목표 달성률: ${t.rate == null ? "—" : `${t.rate.toFixed(2)}%`}`);
  if (t.gap != null) L.push(t.gap < 0 ? `▶ 목표 미달액: ${won(-t.gap)}` : `▶ 목표 초과액: ${won(t.gap)}`);
  L.push("");
  if (t.status === "bad") L.push(`아쉽게도 ${M} 팀 목표는 최종 미달성으로 마감되었습니다.`, "");
  else if (t.status === "ok") L.push(`${M} 팀 목표를 달성했습니다! 1인당 ${won(cfg.teamReward)}의 팀 인센티브가 지급됩니다. 🎉`, "");
  else L.push(`${M} 팀 목표 결과는 마감 확정 후 안내드립니다.`, "");
  L.push(`[${M} 개인 목표 달성 현황]`, "");
  for (const r of rows) {
    L.push(`▶ ${r.name}`, `${M} 마감: ${won(r.actual)}`, `${M} 목표: ${won(r.target)}`);
    if (r.actual != null && r.target != null) {
      const g = r.actual - r.target;
      L.push(g >= 0 ? `목표 초과: ${plus(g)}` : `목표까지: ${plus(g)}`, g >= 0 ? "목표 달성 🎉" : "목표 미달성");
    }
    L.push("");
  }
  const keep = rows.filter((r) => r.keep === "ok" || r.keep === "part" || r.keep === "bad");
  if (keep.length) {
    L.push("[기존 상승분 유지 결과]", "");
    for (const r of keep) {
      L.push(`▶ ${r.name}`, `${P2} 마감: ${won(r.prev2)}`, `${P} 마감: ${won(r.prev)}`, `${M} 마감: ${won(r.actual)}`, "");
      L.push(r.keep === "ok" ? `${P} 상승분 2개월 유지 조건 충족` : r.keep === "part" ? `${P} 상승분 부분 유지 (${r.prevBands}구간 중 ${r.keptBands}구간)` : `${P} 상승분 유지 조건 미충족`);
      L.push(r.excluded ? "※ 이번 달 지급 제외" : r.keepAmt > 0 ? `⭐인센티브 인정 후보: ${won(r.keepAmt)}⭐` : "인센티브 해당 없음", "");
    }
  }
  const nw = rows.filter((r) => (r.newBands ?? 0) > 0 && !r.excluded);
  if (nw.length) {
    L.push(`[${M} 신규 상승분 인센티브 후보]`);
    for (const r of nw) L.push(`▶ ${r.name}`, `${P} 대비 증가액: ${plus(r.delta ?? 0)}`, `🔥 추가 인센티브 후보: ${won(r.newAmt)}`, "");
    L.push(`※ ${M} 신규 상승분은 ${N}에도 유지 여부 확인 후 최종 인정됩니다.`);
  }
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
