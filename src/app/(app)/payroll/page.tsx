import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { TRACK_LABEL } from "@/lib/payroll";
import { ConfirmSubmit } from "../billing/panel";
import { addEntry, closeMonth, importDashboardSpend, removeEntry, reopenMonth, saveEntry, saveMonth, startMonth } from "./actions";
import { currentYm, loadPayrollMonth, shiftYm } from "./data";
import { DashboardImport, EntryEditor, MonthForm } from "./forms";

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

export default async function Payroll(props: PageProps<"/payroll">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">급여·인센티브는 대표·팀장만 볼 수 있습니다.</p>;
  // 기본: 지난달 실적
  const ym = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : shiftYm(currentYm(), -1);
  const { month, tiers, profiles, rows, team } = await loadPayrollMonth(supabase, ym);
  const closed = month?.status === "closed";
  const missing = profiles.filter((p) => p.is_active && !rows.some((r) => r.staff_id === p.staff_id));
  const sum = rows.reduce((t, r) => t + r.total, 0);
  const [y, m] = ym.split("-").map(Number);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">급여 · 인센티브</h1>
          <p className="text-sm text-ink-soft">대표·팀장만 볼 수 있습니다. {y}년 {m}월 실적 기준</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/payroll?m=${shiftYm(ym, -1)}`} className="btn btn-ghost">← 이전 달</Link>
          <span className="chip chip-info">{y}년 {m}월 실적</span>
          <Link href={`/payroll?m=${shiftYm(ym, 1)}`} className="btn btn-ghost">다음 달 →</Link>
          <Link href="/payroll/settings" className="btn btn-ghost">급여 설정 · 구간표</Link>
        </div>
      </header>
      {typeof sp.error === "string" && <p className="glass p-3 text-sm text-danger">{sp.error}</p>}

      {!month ? (
        <section className="glass space-y-3 p-5">
          <p className="text-sm">{y}년 {m}월 급여를 아직 시작하지 않았습니다. 시작하면 급여 설정이 켜진 직원 {profiles.filter((p) => p.is_active).length}명의 입력 칸이 만들어집니다.</p>
          <form action={startMonth.bind(null, ym)}><button className="btn">{m}월 급여 시작</button></form>
        </section>
      ) : (
        <>
          <section className="glass space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className={`chip ${closed ? "chip-ok" : "chip-warn"}`}>{closed ? `마감 ${month.closed_at?.slice(0, 10) ?? ""}` : "작성 중"}</span>
                <span>지급 예정 합계 <b className="tabular-nums">{won(sum)}원</b></span>
                <span>팀원 네이버 소진액 <b className="tabular-nums">{won(team.teamNaver)}원</b>
                  {month.team_goal > 0 && <> / 목표 {won(month.team_goal)}원 ({Math.floor((team.teamNaver / month.team_goal) * 100)}%) {team.achieved ? <span className="chip chip-ok">달성</span> : <span className="chip chip-muted">미달</span>}</>}
                </span>
              </div>
              {closed ? (
                me.role === "ceo" && <ConfirmSubmit action={reopenMonth.bind(null, ym)} label="마감 풀기 (대표)" confirmText="마감을 풀면 다시 고칠 수 있습니다. 풀까요?" />
              ) : (
                <form action={closeMonth.bind(null, ym)}><button className="btn">이 달 마감 (금액 확정)</button></form>
              )}
            </div>
            {!closed && <DashboardImport action={importDashboardSpend.bind(null, ym)} />}
            <MonthForm action={saveMonth.bind(null, ym)} goal={Number(month.team_goal)} bonus={Number(month.team_bonus)} memo={month.memo} readOnly={closed} />
          </section>

          <div className="glass overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-ink-soft">
                <tr><th className="px-3 py-2">직원</th><th className="px-3">직군</th><th className="px-3 text-right">마감 소진액</th><th className="px-3">주요 항목</th><th className="px-3 text-right">지급 예정액</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--glass-border)]">
                    <td className="px-3 py-2 font-semibold"><a href={`#e-${r.id}`} className="hover:text-brand hover:underline">{r.name}</a></td>
                    <td className="px-3 py-2">{r.profile ? TRACK_LABEL[r.profile.track] : "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{won(r.spend)}</td>
                    <td className="px-3 py-2 text-xs text-ink-soft">{r.lines.filter((l) => l.key !== "base" && l.amount).map((l) => `${l.label} ${won(l.amount)}`).join(" · ")}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{won(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.map((r) => (
            <section key={r.id} id={`e-${r.id}`} className="glass scroll-mt-4 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold">{r.name} <span className="text-xs font-normal text-ink-soft">{r.profile ? TRACK_LABEL[r.profile.track] : "급여 설정 없음"}</span></h2>
                {!closed && <ConfirmSubmit action={removeEntry.bind(null, ym, r.id)} label="이 달에서 빼기" confirmText={`${r.name} 님을 이 달 급여에서 뺄까요?`} />}
              </div>
              {r.profile ? (
                closed ? (
                  <table className="w-full max-w-xl text-sm">
                    <tbody>
                      {r.lines.map((l, i) => (
                        <tr key={i} className="border-t border-[var(--glass-border)]"><td className="py-1">{l.label}{l.note && <span className="ml-2 text-[11px] text-ink-soft">{l.note}</span>}</td><td className="py-1 text-right tabular-nums">{won(l.amount)}</td></tr>
                      ))}
                      <tr className="border-t-2 border-[var(--glass-border)] font-bold"><td className="py-1.5">지급 예정액 (마감 때 확정)</td><td className="py-1.5 text-right tabular-nums">{won(r.total)}원</td></tr>
                    </tbody>
                  </table>
                ) : (
                  <EntryEditor
                    key={JSON.stringify([r.inputs, r.extras])}
                    action={saveEntry.bind(null, ym, r.id)}
                    profile={r.profile}
                    tiers={tiers}
                    auto={r.auto}
                    inputs={r.inputs}
                    extras={r.extras}
                    memo={r.memo}
                    readOnly={false}
                  />
                )
              ) : (
                <p className="text-sm text-ink-soft"><Link href="/payroll/settings" className="text-brand underline">급여 설정</Link>에서 직군·기본급을 먼저 넣어 주세요.</p>
              )}
            </section>
          ))}

          {!closed && missing.length > 0 && (
            <section className="glass flex flex-wrap items-center gap-2 p-4 text-sm">
              <span className="text-ink-soft">이 달에 빠진 직원:</span>
              {missing.map((p) => (
                <form key={p.staff_id} action={addEntry.bind(null, ym, p.staff_id)}><button className="btn btn-ghost">{p.name} 추가</button></form>
              ))}
            </section>
          )}
          <p className="text-xs text-ink-soft">
            네이버·메타 소진액은 「대시보드에서 소진액 불러오기」로 채울 수 있습니다. 진원 인계건은 대시보드의 「광고주 그룹 급여 구분」 기준으로 함께 불러옵니다. 카카오 등 다른 매체와 마크업 수수료는 직접 입력합니다.
            바이럴은 통합 시스템의 입금일 기준 그 달 판매가(VAT 별도)를 자동으로 가져오며, 제품비처럼 인센티브 제외로 표시된 상품은 뺍니다.
          </p>
        </>
      )}
    </div>
  );
}
