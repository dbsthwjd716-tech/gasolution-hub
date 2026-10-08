import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { fetchBizmoney } from "@/lib/ads-legacy";
import { cycleLabel, upcoming, type Routine } from "@/lib/routines";
import { ConfirmSubmit } from "../../billing/panel";
import { addRoutine, removeRoutine, setRoutineActive } from "../ops-actions";
import { RoutineForm } from "../ops-forms";

type Row = Routine & { title: string; advertiser_name: string | null; due_time: string | null; memo: string | null; staff: { name: string } | null };
const WD = ["", "월", "화", "수", "목", "금", "토", "일"];
const label = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${WD[((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1]})`;

// 루틴·약속 관리: 등록·멈춤·삭제와 다음 7일 일정 (직원은 본인 것, 대표·팀장은 전체)
export default async function Routines(props: PageProps<"/ads/routines">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!me) return null;
  const manager = me.role !== "staff";
  const today = todayKST();
  const [{ data }, { data: staff }, biz] = await Promise.all([
    supabase.from("ops_routines").select("id,title,advertiser_name,kind,weekdays,month_day,due_date,due_time,start_date,is_active,memo,staff:staff_id(name)").order("created_at", { ascending: false }).returns<Row[]>(),
    supabase.from("staff").select("id,name").eq("is_active", true).order("name"),
    fetchBizmoney(),
  ]);
  const who = manager ? (typeof sp.m === "string" ? sp.m : "") : me.name;
  const rows = (data ?? []).filter((r) => !who || r.staff?.name === who);
  const active = rows.filter((r) => r.is_active && !(r.kind === "once" && r.due_date && r.due_date < today));
  const ended = rows.filter((r) => !active.includes(r));
  const week = active.flatMap((r) => upcoming(r, today, 7).map((d) => ({ d, r }))).sort((a, b) => a.d.localeCompare(b.d));
  const advertisers = [...new Set((biz.data?.rows ?? []).filter((r) => !who || r.manager === who).map((r) => r.advertiser_name ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">루틴 · 약속 관리</h1>
          <p className="text-sm text-ink-soft">여기 등록한 일이 해야 하는 날 「오늘의 운영」에 나오고, 완료를 눌러야 빠집니다. 매주·매월·약속은 지나도 완료할 때까지 남습니다.</p>
        </div>
        {manager && (
          <form className="flex gap-2">
            <select name="m" defaultValue={who} className="field !w-auto" aria-label="담당자">
              <option value="">전체 담당자</option>
              {(staff ?? []).map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
            </select>
            <button className="btn btn-ghost">보기</button>
          </form>
        )}
      </header>

      <section className="glass p-5">
        <h2 className="mb-3 text-sm font-bold">새 루틴 · 약속</h2>
        <RoutineForm action={addRoutine} staff={manager ? (staff ?? []) : []} advertisers={advertisers} defaultStaff={me.id} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <section className="glass p-5">
          <h2 className="text-sm font-bold">진행 중 {active.length}개</h2>
          <ul className="mt-2 divide-y divide-[#edf1f7] text-sm">
            {active.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p><b>{r.title}</b>{r.advertiser_name && <span className="ml-1.5 text-ink-soft">· {r.advertiser_name}</span>}</p>
                  <p className="text-xs text-ink-soft">{cycleLabel(r)}{manager && !who ? ` · ${r.staff?.name}` : ""}{r.memo ? ` · ${r.memo}` : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  <form action={setRoutineActive.bind(null, r.id, false)}><button className="text-xs text-ink-soft underline">멈추기</button></form>
                  <ConfirmSubmit action={removeRoutine.bind(null, r.id)} label="삭제" confirmText={`「${r.title}」를 삭제할까요? 완료 기록도 함께 지워집니다.`} />
                </div>
              </li>
            ))}
            {!active.length && <li className="py-2 text-ink-soft">등록한 루틴이 없습니다. 위에서 추가해 주세요.</li>}
          </ul>
          {ended.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs text-ink-soft">멈춘 루틴 · 지난 약속 {ended.length}개</summary>
              <ul className="mt-1 divide-y divide-[#edf1f7]">
                {ended.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2 text-ink-soft">
                    <span>{r.title}{r.advertiser_name ? ` · ${r.advertiser_name}` : ""} · {cycleLabel(r)}</span>
                    <span className="flex gap-3">
                      {!r.is_active && <form action={setRoutineActive.bind(null, r.id, true)}><button className="text-xs text-brand underline">다시 시작</button></form>}
                      <ConfirmSubmit action={removeRoutine.bind(null, r.id)} label="삭제" confirmText={`「${r.title}」를 삭제할까요?`} />
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
        <section className="glass p-5">
          <h2 className="text-sm font-bold">다음 7일</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {week.map(({ d, r }) => (
              <li key={`${r.id}|${d}`} className="flex gap-2">
                <span className="w-16 shrink-0 text-xs text-ink-soft tabular-nums">{label(d)}</span>
                <span>{r.title}{r.advertiser_name ? <span className="text-ink-soft"> · {r.advertiser_name}</span> : ""}</span>
              </li>
            ))}
            {!week.length && <li className="text-ink-soft">예정된 일이 없습니다.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
