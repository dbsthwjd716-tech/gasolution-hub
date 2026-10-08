import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { computePromo, goalNotice, resultNotice, type PersonResult, type PromoTarget, type TeamResult } from "@/lib/promo";
import { fetchPromoSpend } from "@/lib/ads-legacy";
import { ConfirmSubmit } from "../billing/panel";
import { addTarget, closeWeek, createWeek, removeTarget, reopenWeek, saveWeek } from "./actions";
import { AddTargetForm, CopyNotice, NewWeekForm, WeekForm } from "./forms";

const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

type WeekRow = {
  id: string; title: string | null; base_start: string; base_end: string; week_start: string; week_end: string;
  team_increment: number; reward_personal: string; reward_team: string; memo: string | null; closed_at: string | null;
  reward_personal_hours: number; reward_team_hours: number;
  results: { people: PersonResult[]; team: TeamResult; complete: boolean; fullDays: number } | null;
  promo_targets: { staff_id: string; increment: number; scope: "naver" | "naver_meta"; in_team: boolean; staff: { name: string } | null }[];
};

function Bar({ p }: { p: { rate: number | null; achieved: boolean } }) {
  const w = Math.max(0, Math.min(100, p.rate ?? 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[#e6ecf7]" role="img" aria-label={`목표 대비 ${p.rate ?? 0}%`}>
      <div className={`h-full rounded-full ${p.achieved ? "bg-[var(--ok-ink)]" : "bg-brand"}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function Card({ name, r, sub }: { name: string; r: PersonResult | TeamResult; sub?: string }) {
  return (
    <div className={`rounded-xl border p-4 ${r.achieved ? "border-[var(--ok-ink)]/40 bg-[var(--ok-bg)]/50" : "border-[var(--glass-border)] bg-white/70"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold">{name}</p>
        <span className={`chip ${r.achieved ? "chip-ok" : "chip-muted"}`}>{r.achieved ? "달성" : "미달성"}</span>
      </div>
      {sub && <p className="text-xs text-ink-soft">{sub}</p>}
      <p className="mt-2 text-2xl font-bold tabular-nums">{won(r.current)}</p>
      <p className="text-xs text-ink-soft tabular-nums">목표 {won(r.target)} · 기준 {won(r.base)} + {won(r.increment)}</p>
      <div className="mt-2"><Bar p={r} /></div>
      <p className={`mt-1 text-xs tabular-nums ${r.gap >= 0 ? "text-[var(--ok-ink)]" : "text-danger"}`}>
        {r.gap >= 0 ? `목표보다 +${won(r.gap)}` : `목표까지 ${won(-r.gap)} 부족`} · 상승 {r.rise >= 0 ? "+" : ""}{won(r.rise)}{r.rate != null ? ` (${r.rate}%)` : ""}
      </p>
    </div>
  );
}

// 주간 일소진 상승 프로모션
export default async function Promotions() {
  const { supabase, me } = await getMe();
  if (!me) return null;
  const manager = me.role !== "staff";
  const today = todayKST();
  const [{ data: weeks }, { data: staff }, { data: history }] = await Promise.all([
    supabase.from("promo_weeks").select("*, promo_targets(staff_id,increment,scope,in_team,staff(name))").order("week_start", { ascending: false }).limit(8).returns<WeekRow[]>(),
    supabase.from("staff").select("id,name,role").eq("is_active", true).order("name"),
    manager ? supabase.from("promo_history").select("week_id,what,changed_at,before,after,staff:changed_by(name)").order("changed_at", { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
  ]);
  const list = weeks ?? [];
  const live = list.filter((w) => !w.closed_at);
  const oldest = live.map((w) => w.base_start).sort()[0];
  const newest = live.map((w) => w.week_end).sort().reverse()[0];
  const spend = oldest && newest ? await fetchPromoSpend(oldest, newest < today ? newest : today) : { data: undefined, error: undefined };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">주간 일소진 상승 프로모션</h1>
        <p className="text-sm text-ink-soft">
          평가 주(월~일)의 일평균 광고비가 직전 주 일평균 + 상승 목표 이상이면 달성 · 개인과 팀은 따로 판정 · 네이버 유상실적(VAT 별도, 급여 실적과 같은 기준) + 대상에 따라 메타 · 바이럴 제외
        </p>
        {spend.data && <p className="text-xs text-ink-soft">데이터 반영: 네이버 {spend.data.naver_through ?? "-"}까지 · 메타 {spend.data.meta_through ?? "-"}까지 (네이버 유상실적은 예전 대시보드에 올린 CSV 기준)</p>}
        {spend.error && <p className="text-xs text-danger">{spend.error}</p>}
      </header>

      {manager && (
        <section className="glass p-5">
          <NewWeekForm action={createWeek} defaultDay={today} />
        </section>
      )}

      {!list.length && <p className="glass p-5 text-sm text-ink-soft">아직 등록된 주차가 없습니다.{manager ? " 위에서 주차를 만들어 주세요." : ""}</p>}

      {list.map((w) => {
        const targets: PromoTarget[] = w.promo_targets.map((t) => ({ staff_id: t.staff_id, name: t.staff?.name ?? "", increment: Number(t.increment), scope: t.scope, in_team: t.in_team }))
          .sort((a, b) => b.increment - a.increment);
        const r = w.results ?? (spend.data ? computePromo(spend.data, targets, { start: w.base_start, end: w.base_end }, { start: w.week_start, end: w.week_end }, Number(w.team_increment)) : null);
        const state = w.closed_at ? "마감" : w.week_start > today ? "예정" : w.week_end < today ? "평가 끝 · 마감 전" : "진행 중";
        const asOf = (w.results as { data_through?: { naver?: string } } | null)?.data_through?.naver ?? spend.data?.naver_through ?? today;
        const goal = r ? goalNotice({ ...r, fullDays: r.fullDays ?? 7 }, { start: w.week_start, end: w.week_end }) : "";
        const result = r ? resultNotice({ ...r, fullDays: r.fullDays ?? 7 }, asOf < w.week_end ? asOf : w.week_end, Number(w.reward_personal_hours), Number(w.reward_team_hours)) : "";
        const remaining = (staff ?? []).filter((s) => !targets.some((t) => t.staff_id === s.id));
        const hist = (history ?? []).filter((h) => h.week_id === w.id);
        return (
          <section key={w.id} className="glass space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">{w.title || `${md(w.week_start)}~${md(w.week_end)} 주`} <span className={`chip ml-1 ${state === "진행 중" ? "chip-info" : state === "마감" ? "chip-muted" : "chip-warn"}`}>{state}</span></h2>
                <p className="text-xs text-ink-soft">기준 {md(w.base_start)}~{md(w.base_end)} 일평균 → 평가 {md(w.week_start)}~{md(w.week_end)} 일평균{r && !r.complete && state !== "예정" ? ` · ${Math.min(...r.people.map((p) => p.days), 7)}일치 반영 (데이터가 들어오는 대로 갱신)` : ""}</p>
                <p className="mt-1 text-sm">🎁 개인 달성: {Number(w.reward_personal_hours)}시간 조기퇴근 ({w.reward_personal}) · 팀 달성: 금요일 {Number(w.reward_team_hours)}시간 조기퇴근 ({w.reward_team})</p>
                {w.memo && <p className="text-xs text-ink-soft">{w.memo}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {goal && <CopyNotice text={goal} label="① 목표 공지 복사" />}
                {result && state !== "예정" && <CopyNotice text={result} label={w.closed_at ? "② 결과 공지 복사" : "② 결과 공지 (중간) 복사"} />}
                {manager && !w.closed_at && w.week_end < today && <ConfirmSubmit action={closeWeek.bind(null, w.id)} label="마감 (결과 확정)" confirmText="지금 숫자로 결과를 확정할까요? 마감 후에는 마감을 풀어야 고칠 수 있습니다." />}
                {manager && w.closed_at && <ConfirmSubmit action={reopenWeek.bind(null, w.id)} label="마감 풀기" confirmText="마감을 풀고 다시 계산할까요?" />}
              </div>
            </div>

            {r && targets.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {r.people.map((p) => <Card key={p.staff_id} name={p.name} r={p} sub={p.scope === "naver" ? "네이버 (인계건·바이럴 제외)" : "네이버 + 메타 (바이럴 제외)"} />)}
                <Card name="팀" r={r.team} sub={`${r.team.members.join("·")} 합산`} />
              </div>
            ) : (
              <p className="text-sm text-ink-soft">{targets.length ? "광고비를 불러오지 못했습니다." : "대상이 없습니다."}</p>
            )}

            {r && r.people.some((p) => p.achieved) && w.closed_at && (
              <p className="text-xs text-ink-soft">
                조기퇴근은 <Link href="/attendance/status" className="text-brand underline">근태 현황</Link>의 “직원 대신 근태 예외 넣기”에서 프로모션 조기퇴근으로 등록하면 퇴근 시각이 조퇴로 잡히지 않습니다.
              </p>
            )}

            {manager && !w.closed_at && (
              <details className="rounded-xl border border-[var(--glass-border)] bg-white/50 p-4" open={state !== "마감" && targets.length === 0}>
                <summary className="cursor-pointer text-sm font-semibold">목표·기간 고치기 (연휴·광고비 변동 반영)</summary>
                <div className="mt-3 space-y-3">
                  <WeekForm
                    key={`${w.id}-${targets.map((t) => `${t.staff_id}${t.increment}${t.scope}${t.in_team}`).join()}-${w.reward_personal_hours}${w.reward_team_hours}`}
                    action={saveWeek.bind(null, w.id)}
                    week={w}
                    targets={targets}
                    individualSum={targets.reduce((t, x) => t + x.increment, 0)}
                  />
                  <AddTargetForm action={addTarget.bind(null, w.id)} staff={remaining.map((s) => ({ id: s.id, name: s.name }))} />
                  {targets.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {targets.map((t) => <ConfirmSubmit key={t.staff_id} action={removeTarget.bind(null, w.id, t.staff_id)} label={`${t.name} 빼기`} confirmText={`${t.name}을(를) 이번 주 대상에서 뺄까요?`} />)}
                    </div>
                  )}
                  {hist.length > 0 && (
                    <details className="text-xs text-ink-soft">
                      <summary className="cursor-pointer">변경 이력 {hist.length}건</summary>
                      <ul className="mt-1 space-y-0.5">
                        {hist.map((h, i) => (
                          <li key={i}>{h.changed_at.slice(5, 16).replace("T", " ")} · {(h.staff as unknown as { name: string } | null)?.name ?? ""} · {h.what}: {h.before ? JSON.stringify(h.before) : "-"} → {h.after ? JSON.stringify(h.after) : "-"}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
