import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { todayKST } from "@/lib/billing-calc";
import { jobState, opsActions, type JobState } from "@/lib/ads";
import { fetchBizmoney, fetchOpsStatus } from "@/lib/ads-legacy";
import { ackAlert } from "../actions";

// 요청 시점의 시각 (화면을 그릴 때마다 바뀌는 값이라 따로 받음)
async function serverNow() {
  return Date.now();
}

const kst = (ts: string | null | undefined) =>
  ts ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)) : "";

const TONE: Record<JobState["state"] | "off", string> = { ok: "chip-ok", error: "chip-danger", pending: "chip-warn", off: "chip-muted" };

// 아침 자동 작업 상태 + 지금 조치할 것 (직원은 본인 담당, 대표·팀장은 전체 또는 담당자 선택)
export default async function OpsToday(props: PageProps<"/ads/today">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!me) return null;
  const manager = me.role !== "staff";
  const today = todayKST();
  const [biz, st, { data: acks }] = await Promise.all([
    fetchBizmoney(),
    fetchOpsStatus(),
    supabase.from("ads_alert_acks").select("alert_key,staff_id,created_at,staff:staff_id(name)").eq("ack_date", today),
  ]);
  if (!biz.data || !st.data) return <p className="glass p-5 text-sm text-danger">{biz.error ?? st.error}</p>;

  const who = manager ? (typeof sp.m === "string" ? sp.m : "") : me.name;
  const rows = biz.data.rows.filter((r) => !who || r.manager === who);
  const prev = biz.data.previous;
  const actions = biz.data.snapshot_date ? opsActions(rows, prev, biz.data.snapshot_date, biz.data.previous_date, today) : [];
  const ackBy = new Map((acks ?? []).map((a) => [a.alert_key, a]));
  const open = actions.filter((a) => !ackBy.has(a.key));
  const done = actions.filter((a) => ackBy.has(a.key));

  const nowMs = await serverNow();
  const now = new Date(nowMs + 9 * 3600000);
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const s = st.data;
  const metaStale = s.meta_accounts.filter((a) => !a.last_synced_at || nowMs - Date.parse(a.last_synced_at) > 26 * 3600000).length;
  const searchadOk = s.searchad_targets > 0 && s.searchad_done >= s.searchad_targets;
  const status: { name: string; state: JobState["state"] | "off"; label: string; at?: string | null }[] = [
    { name: "비즈머니 아침 확인", ...jobState(s.runs, "bizmoney-snapshot", 10.5, hour), ...(biz.data.snapshot_date !== today ? { state: "error" as const, label: `최근 기록 ${biz.data.snapshot_date ?? "없음"}` } : {}) },
    { name: "아침 자동 수집", ...jobState(s.runs, "daily-sync", 11, hour) },
    {
      name: "검색광고 어제 실적",
      state: searchadOk ? "ok" : hour < 13.5 ? "pending" : "error",
      label: s.searchad_targets ? `${s.searchad_done}/${s.searchad_targets}곳 수집${searchadOk ? " 완료" : hour < 13.5 ? " (수집 중)" : ""}` : `최근 수집일 ${s.searchad_latest ?? "없음"}`,
    },
    { name: "메타 광고비", state: !s.meta_accounts.length ? "off" : metaStale ? "error" : "ok", label: !s.meta_accounts.length ? "연결 계정 없음" : metaStale ? `${s.meta_accounts.length}개 중 ${metaStale}개 동기화 지연` : `${s.meta_accounts.length}개 계정 정상` },
  ];
  const managers = [...new Set(biz.data.rows.map((r) => r.manager ?? "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">오늘의 운영</h1>
          <p className="text-sm text-ink-soft">{manager ? (who ? `${who} 담당` : "전체 담당") : "내 담당 광고주"} · 아침 비즈머니 기록과 어제 대비 소진 변화로 판단합니다</p>
        </div>
        {manager && (
          <form action="/ads/today" className="flex gap-2">
            <select name="m" defaultValue={who} className="field !w-auto">
              <option value="">전체 담당자</option>
              {managers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="btn btn-ghost">보기</button>
          </form>
        )}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {status.map((x) => (
          <div key={x.name} className="glass p-4">
            <p className="text-xs text-ink-soft">{x.name}</p>
            <p className="mt-1"><span className={`chip ${TONE[x.state]}`}>{x.label}</span></p>
            {x.at && <p className="mt-1 text-xs text-ink-soft">{kst(x.at)}</p>}
          </div>
        ))}
      </section>

      <section className="glass space-y-2 p-5">
        <h2 className="font-bold">지금 조치할 것 {open.length}건</h2>
        {!open.length && <p className="text-sm text-ink-soft">오늘 확인할 알림이 없습니다.</p>}
        <ul className="divide-y divide-[var(--glass-border)] text-sm">
          {open.map((a) => (
            <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <p>
                  <span className={`chip ${a.severity === 1 ? "chip-danger" : a.severity === 2 ? "chip-warn" : "chip-info"} mr-2`}>{a.label}</span>
                  <b>{a.advertiserName}</b>{manager && <span className="ml-1 text-xs text-ink-soft">· {a.manager}</span>}
                </p>
                <p className="mt-0.5 tabular-nums">{a.title}</p>
                <p className="text-xs text-ink-soft">{a.detail}</p>
              </div>
              {(manager || a.manager === me.name) && (
                <form action={ackAlert.bind(null, a.key)}>
                  <button className="btn btn-ghost !px-3 !py-1.5 text-xs">확인했어요</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {!!done.length && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-ink-soft">오늘 확인한 알림 {done.length}건</summary>
            <ul className="mt-1 space-y-1 text-xs text-ink-soft">
              {done.map((a) => {
                const k = ackBy.get(a.key) as { staff?: { name: string } | null; created_at: string } | undefined;
                return <li key={a.key}>{a.label} · {a.advertiserName} — {k?.staff?.name ?? ""} {kst(k?.created_at)}</li>;
              })}
            </ul>
          </details>
        )}
        <p className="text-xs text-ink-soft">
          위험·주의는 이번 달 소진이 있는 광고주만. 소진 중단은 최근 24시간 0원이고 평소 일평균 1만원 이상, 급변은 평소 대비 ±50% 이상(평소 일평균 3만원 이상).
          확인 처리는 오늘 하루만 유지됩니다. <Link href="/ads" className="text-brand underline">비즈머니 현황 보기</Link>
        </p>
      </section>
    </div>
  );
}
