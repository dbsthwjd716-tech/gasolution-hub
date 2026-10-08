// 광고 운영 화면 계산 (예전 네이버 대시보드와 같은 기준)
//   * 네이버 비즈머니 기록의 소진액·일평균은 VAT 포함 → 화면은 ÷1.1 (VAT 별도). 피이관(transferred) 실적은 이미 VAT 별도
//   * 남은 일수는 비즈머니 ÷ VAT 포함 일평균 (기록에 계산되어 옴)
//   * 위험: 잔액 10만원 이하 또는 3일 이하 / 주의: 50만원 이하 또는 7일 이하 (아침 기록에서 판정되어 옴)

export type BizRow = {
  customer_id: string;
  advertiser_name: string | null;
  manager: string | null;
  source: string;
  key_source: string | null;
  bizmoney: number | null;
  gross_total_cost: number | null;
  gross_daily_average: number | null;
  calculation_days: number | null;
  period_start: string | null;
  period_end: string | null;
  expected_days: number | null;
  status: "normal" | "warning" | "danger" | "transferred" | "failed";
  reason: string | null;
  error: string | null;
  captured_at: string | null;
  prev_period_start: string | null;
  prev_period_end: string | null;
  prev_active: boolean | null;
  prev_total_cost: number | null;
  prev_daily_average: number | null;
  transferred_at: string | null;
  adcost_source: string | null;
  gfa_ad_account_no: number | null;
  client_group: string | null;
};

export type PrevRow = { customer_id: string; gross_total_cost: number | null; gross_daily_average: number | null; source: string; period_start: string | null };

export const STATUS_LABEL: Record<BizRow["status"], { label: string; chip: string }> = {
  danger: { label: "위험", chip: "chip-danger" },
  warning: { label: "주의", chip: "chip-warn" },
  failed: { label: "조회 실패", chip: "chip-muted" },
  normal: { label: "정상", chip: "chip-ok" },
  transferred: { label: "피이관", chip: "chip-info" },
};

const RANK: Record<BizRow["status"], number> = { danger: 4, warning: 3, failed: 2, normal: 1, transferred: 0 };

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

// 화면용 금액 (VAT 별도)
export function netCost(r: BizRow) {
  return r.source === "transferred" ? n(r.gross_total_cost) : Math.round(n(r.gross_total_cost) / 1.1);
}
export function netDaily(r: BizRow) {
  return r.source === "transferred" ? n(r.gross_daily_average) : Math.round(n(r.gross_daily_average) / 1.1);
}

export function daysInMonth(ymd: string) {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthEnd(ymd: string) {
  return `${ymd.slice(0, 7)}-${String(daysInMonth(ymd)).padStart(2, "0")}`;
}

// 자동 숨김: 이번 기간 소진 0원(조회 실패 제외), 피이관한 달이 지난 피이관 업체
export function hiddenReason(r: BizRow): "zero" | "old_transferred" | null {
  if (r.source === "transferred" && r.transferred_at && r.period_start && r.period_start > monthEnd(r.transferred_at)) return "old_transferred";
  if (r.status !== "failed" && netCost(r) === 0) return "zero";
  return null;
}

export function sortRows(rows: BizRow[]) {
  return [...rows].sort((a, b) => RANK[b.status] - RANK[a.status] || netCost(b) - netCost(a));
}

export type Summary = { count: number; normal: number; warning: number; danger: number; failed: number; cost: number; daily: number; forecast: number; bizmoney: number; prevCost: number };

export function summarize(rows: BizRow[], ymd: string): Summary {
  const s: Summary = { count: 0, normal: 0, warning: 0, danger: 0, failed: 0, cost: 0, daily: 0, forecast: 0, bizmoney: 0, prevCost: 0 };
  const dim = daysInMonth(ymd);
  for (const r of rows) {
    s.count++;
    if (r.status === "normal" || r.status === "transferred") s.normal++;
    else s[r.status]++;
    s.cost += netCost(r);
    s.daily += netDaily(r);
    s.bizmoney += n(r.bizmoney);
    s.prevCost += n(r.prev_total_cost);
  }
  s.forecast = Math.round(s.daily * dim);
  return s;
}

// 전월 같은 기간 대비 (%). 전월이 0이면 null
export function changePct(now: number, prev: number) {
  return prev > 0 ? Math.round(((now - prev) / prev) * 1000) / 10 : null;
}

// ------------------------------------------------------------------ 오늘의 운영: 지금 조치할 것
export const OPS_RULES = { stoppedMinDailyAverage: 10000, changeRatio: 0.5, changeMinDailyAverage: 30000 };

export type OpsAction = {
  key: string;
  type: "bizmoney_danger" | "bizmoney_warning" | "bizmoney_failed" | "spend_stopped" | "spend_change";
  severity: 1 | 2 | 3;
  label: string;
  title: string;
  detail: string;
  customerId: string;
  advertiserName: string;
  manager: string;
};

const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;

function addDays(d: string, k: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + k);
  return t.toISOString().slice(0, 10);
}

// alert key는 '종류:광고주번호:오늘' — 오늘 하루만 '확인' 처리가 유지됨
export function opsActions(rows: BizRow[], previous: PrevRow[], snapshotDate: string, previousDate: string | null, today: string): OpsAction[] {
  const out: OpsAction[] = [];
  const prevBy = new Map(previous.map((p) => [String(p.customer_id), p]));
  const push = (a: Omit<OpsAction, "key">) => out.push({ ...a, key: `${a.type}:${a.customerId}:${today}` });
  for (const r of rows) {
    const base = { customerId: String(r.customer_id), advertiserName: r.advertiser_name || String(r.customer_id), manager: r.manager || "" };
    const spending = n(r.gross_total_cost) > 0;
    if ((r.status === "danger" || r.status === "warning") && spending) {
      const d = r.expected_days == null ? null : Number(r.expected_days);
      push({
        ...base,
        type: r.status === "danger" ? "bizmoney_danger" : "bizmoney_warning",
        severity: r.status === "danger" ? 1 : 2,
        label: r.status === "danger" ? "비즈머니 위험" : "비즈머니 주의",
        title: `비즈머니 ${won(n(r.bizmoney))}${d == null ? "" : ` · 약 ${d < 1 ? "1일 미만" : `${Math.floor(d)}일`} 남음`}`,
        detail: `${r.reason || ""} · 일평균 ${won(n(r.gross_daily_average))} (VAT 포함)`,
      });
    }
    if (r.status === "failed") {
      push({ ...base, type: "bizmoney_failed", severity: 2, label: "조회 실패", title: r.reason || "비즈머니 조회 실패", detail: r.error ? String(r.error).slice(0, 120) : "API 키 또는 계정 연결을 확인해 주세요." });
    }
    const p = prevBy.get(base.customerId);
    const same =
      p && previousDate === addDays(snapshotDate, -1) && r.source === "naver_api" && p.source === "naver_api" &&
      r.period_start === p.period_start && r.gross_total_cost != null && p.gross_total_cost != null;
    if (same) {
      const last24h = n(r.gross_total_cost) - n(p.gross_total_cost);
      const usual = n(p.gross_daily_average);
      if (last24h <= 0 && usual >= OPS_RULES.stoppedMinDailyAverage) {
        push({ ...base, type: "spend_stopped", severity: 2, label: "소진 중단 의심", title: `최근 24시간 광고비 0원 (평소 일평균 ${won(usual)})`, detail: "검수 반려, 예산 소진, 캠페인 OFF 여부를 확인해 주세요." });
      } else if (usual >= OPS_RULES.changeMinDailyAverage && last24h > 0) {
        const ratio = (last24h - usual) / usual;
        if (Math.abs(ratio) >= OPS_RULES.changeRatio) {
          push({ ...base, type: "spend_change", severity: 3, label: ratio > 0 ? "소진 급증" : "소진 급감", title: `최근 24시간 ${won(last24h)} (평소 대비 ${ratio > 0 ? "+" : ""}${Math.round(ratio * 100)}%)`, detail: `평소 일평균 ${won(usual)}` });
        }
      }
    }
  }
  return out.sort((a, b) => a.severity - b.severity || a.advertiserName.localeCompare(b.advertiserName, "ko"));
}

// ------------------------------------------------------------------ 아침 자동 작업 상태
export type Run = { job: string; started_at: string; finished_at: string | null; ok: boolean | null };
export type JobState = { state: "ok" | "error" | "pending"; label: string; at?: string | null };

export function jobState(runs: Run[], job: string, dueHour: number, hourKst: number): JobState {
  const list = runs.filter((r) => r.job === job);
  if (!list.length) return hourKst >= dueHour ? { state: "error", label: "오늘 실행 기록 없음" } : { state: "pending", label: "실행 대기" };
  const latest = list[0];
  if (!latest.finished_at) return { state: "pending", label: "실행 중", at: latest.started_at };
  const ok = list.some((r) => r.ok === true);
  if (!ok && hourKst < dueHour) return { state: "pending", label: "2차 실행 대기", at: latest.finished_at };
  return { state: ok ? "ok" : "error", label: ok ? "정상" : "실패", at: latest.finished_at };
}
