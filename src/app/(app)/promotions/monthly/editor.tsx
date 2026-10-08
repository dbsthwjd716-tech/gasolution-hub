"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { teamSum, type PromoConfig, type PromoMember } from "@/lib/monthly-promo";
import { deleteMonth, loadSpend, saveConfig, saveMonth, type MonthInput, type SaveState } from "./actions";

const fmt = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("ko-KR"));
const parse = (s: string) => {
  const d = s.replace(/[^\d]/g, "");
  return d ? Number(d) : null;
};
const won = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`);

function Money({ value, onChange, label, placeholder }: { value: number | null; onChange: (v: number | null) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState(fmt(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setText(fmt(value));
  }
  return (
    <input
      className="field !py-1.5 text-right tabular-nums"
      inputMode="numeric"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = parse(text);
        setLast(n);
        setText(fmt(n));
        onChange(n);
      }}
    />
  );
}

type Auto = { ready: boolean; members: Record<string, { target: number; kind: "auto" | "carry" }> };
const blank = (): PromoMember => ({ name: "", target: null, actual: null, inTeam: true, teamAmount: null, leader: false, excluded: false, note: "" });

export function MonthEditor({ initial, isNew, auto, prevLabel, existing }: { initial: MonthInput; isNew: boolean; auto: Auto; prevLabel: string; existing: string[] }) {
  const router = useRouter();
  const [m, setM] = useState<MonthInput>(initial);
  const [msg, setMsg] = useState<SaveState>({ error: "" });
  const [pending, start] = useTransition();
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (i: number, patch: Partial<PromoMember>) => setM((x) => ({ ...x, members: x.members.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const sum = teamSum(m.members);

  const save = () =>
    start(async () => {
      const at = auto.members;
      const members: PromoMember[] = m.members.map((r) => ({ ...r, targetKind: r.target == null ? null : at[r.name]?.target === r.target ? at[r.name].kind : "manual" }));
      const teamKind = m.teamTarget == null ? null : m.teamTarget === teamSum(members) ? "sum" : "manual";
      const res = await saveMonth({ ...m, members, teamKind }, isNew);
      setMsg(res);
      if (!res.error) router.push(`/promotions/monthly?m=${m.month}`);
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm font-semibold">
          마감 월
          {isNew ? (
            <input type="month" className="field" value={m.month} onChange={(e) => setM({ ...m, month: e.target.value })} />
          ) : (
            <p className="field !bg-[#f4f7fd]">{m.month.replace("-", "년 ")}월</p>
          )}
          {isNew && existing.includes(m.month) && <span className="block text-xs text-danger">이미 있는 달입니다</span>}
        </label>
        <label className="space-y-1 text-sm font-semibold">
          팀 목표(원) <span className="text-xs font-normal text-ink-soft">팀 산정 인원 목표 합계 {won(sum)}</span>
          <Money value={m.teamTarget} onChange={(v) => setM((x) => ({ ...x, teamTarget: v }))} label="팀 목표" />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
          <input type="checkbox" checked={m.closed} onChange={(e) => setM({ ...m, closed: e.target.checked })} className="h-4 w-4" /> 마감 확정
          <span className="text-xs font-normal text-ink-soft">(체크하면 지급액이 확정됩니다)</span>
        </label>
      </div>

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-soft [&>th]:px-1 [&>th]:pb-1 [&>th]:font-medium">
              <th>이름</th><th className="text-right">개인 목표(원)</th><th className="text-right">마감액(원)</th><th className="text-center">팀 산정</th>
              <th className="text-right">팀 산정액(원)</th><th className="text-center">팀장</th><th className="text-center">지급 제외</th><th>메모</th><th />
            </tr>
          </thead>
          <tbody>
            {m.members.map((r, i) => (
              <tr key={i} className="[&>td]:px-1 [&>td]:py-1 align-top">
                <td className="w-28"><input className="field !py-1.5" aria-label="이름" value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td className="w-40">
                  <Money value={r.target} onChange={(v) => set(i, { target: v })} label="개인 목표" />
                  {auto.members[r.name] && <span className="block pt-0.5 text-right text-[11px] text-ink-soft">{auto.members[r.name].kind === "auto" ? "자동" : "미달성 유지"} {won(auto.members[r.name].target)}</span>}
                </td>
                <td className="w-40"><Money value={r.actual} onChange={(v) => set(i, { actual: v })} label="마감액" /></td>
                <td className="text-center"><input type="checkbox" className="mt-2 h-4 w-4" aria-label="팀 산정 포함" checked={r.inTeam} onChange={(e) => set(i, { inTeam: e.target.checked })} /></td>
                <td className="w-40"><Money value={r.teamAmount} onChange={(v) => set(i, { teamAmount: v })} label="팀 산정액" placeholder="비우면 마감액" /></td>
                <td className="text-center"><input type="checkbox" className="mt-2 h-4 w-4" aria-label="팀장" checked={r.leader} onChange={(e) => set(i, { leader: e.target.checked, inTeam: e.target.checked ? false : r.inTeam })} /></td>
                <td className="text-center"><input type="checkbox" className="mt-2 h-4 w-4" aria-label="지급 제외" checked={r.excluded} onChange={(e) => set(i, { excluded: e.target.checked })} /></td>
                <td><input className="field !py-1.5" aria-label="메모" value={r.note} onChange={(e) => set(i, { note: e.target.value })} /></td>
                <td><button type="button" className="mt-1.5 text-xs text-danger underline" onClick={() => setM((x) => ({ ...x, members: x.members.filter((_, j) => j !== i) }))}>빼기</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost !py-1.5 text-xs" onClick={() => setM((x) => ({ ...x, members: [...x.members, blank()] }))}>팀원 추가</button>
        <button
          type="button"
          className="btn btn-ghost !py-1.5 text-xs"
          disabled={!auto.ready}
          onClick={() => {
            const members = m.members.map((r) => (auto.members[r.name] ? { ...r, target: auto.members[r.name].target } : r));
            setM({ ...m, members, teamTarget: teamSum(members) });
            setMsg({ error: "", ok: "자동 목표와 팀 목표 합계를 넣었습니다. 저장해야 반영됩니다." });
          }}
        >
          자동 목표 다시 넣기
        </button>
        <button type="button" className="btn btn-ghost !py-1.5 text-xs" onClick={() => setM({ ...m, teamTarget: sum })}>팀 목표 = 합계로</button>
        <button
          type="button"
          className="btn btn-ghost !py-1.5 text-xs"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await loadSpend(m.month);
              if (!res.rows) return setMsg({ error: res.error ?? "불러오지 못했습니다." });
              const got = new Map(res.rows.map((r) => [r.name, r]));
              const hit: string[] = [];
              const members = m.members.map((r) => {
                const g = got.get(r.name);
                if (!g) return r;
                hit.push(`${r.name}(${g.basis})`);
                return { ...r, actual: g.actual, teamAmount: null };
              });
              setM({ ...m, members });
              setMsg(hit.length ? { error: "", ok: `${hit.join(", ")} 마감액을 넣었습니다 (네이버 ${res.through ?? "-"}까지 반영). 확인 후 저장해 주세요.` } : { error: "이 달 광고비 실적에서 이름이 맞는 담당자가 없습니다." });
            })
          }
        >
          광고비 실적에서 마감액 불러오기
        </button>
        <span className="text-xs text-ink-soft">{auto.ready ? `${prevLabel} 마감 기준 자동 목표: 달성자는 마감 + 상승폭을 절삭, 미달성자는 기존 목표 유지` : `${prevLabel}이 마감 확정되면 자동 목표가 계산됩니다`}</span>
      </div>
      <p className="text-xs text-ink-soft">
        마감액 불러오기는 급여의 직군 기준입니다. 영업 AE(서진원) = 본인 네이버(인계건 미포함) + 메타 ÷ 1.1 · 비영업 AE(박규진·박영서)와 팀장 = 네이버 + 메타 ÷ 1.1 + 바이럴 판매가(총 취급고). 숫자는 고칠 수 있고, 저장해야 반영됩니다.
      </p>

      <label className="block space-y-1 text-sm font-semibold">
        월 메모
        <input className="field" value={m.memo} onChange={(e) => setM({ ...m, memo: e.target.value })} placeholder="예: 퇴사자 발생으로 광고주 재배분" />
      </label>

      {msg.error && <p className="text-sm text-danger">{msg.error}</p>}
      {msg.ok && <p className="text-sm text-[var(--ok-ink)]">{msg.ok}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" className="btn" disabled={pending || (isNew && existing.includes(m.month))} onClick={save}>{pending ? "처리 중…" : "저장"}</button>
          <button type="button" className="btn btn-ghost" onClick={() => router.push(`/promotions/monthly${isNew ? "" : `?m=${m.month}`}`)}>취소</button>
        </div>
        {!isNew && (
          <button
            type="button"
            className="text-xs text-danger underline"
            onClick={() => {
              if (!confirmDel) return setConfirmDel(true);
              start(async () => {
                const res = await deleteMonth(m.month);
                if (res.error) setMsg(res);
                else router.push("/promotions/monthly");
              });
            }}
          >
            {confirmDel ? "한 번 더 누르면 이 달이 삭제됩니다" : "이 달 삭제"}
          </button>
        )}
      </div>
    </div>
  );
}

export function ConfigForm({ cfg }: { cfg: PromoConfig }) {
  const [state, action, pending] = useActionState(saveConfig, { error: "" });
  const f = (name: string, label: string, v: number) => (
    <label className="space-y-1 text-sm font-semibold">
      {label}
      <input name={name} className="field text-right tabular-nums" inputMode="numeric" defaultValue={fmt(v)} />
    </label>
  );
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {f("band_size", "상승 구간 단위(원)", cfg.bandSize)}
        {f("band_reward", "구간당 인센티브(원)", cfg.bandReward)}
        {f("team_reward", "팀 목표 달성 시 1인당(원)", cfg.teamReward)}
        {f("goal_step", "자동 목표 상승폭(원)", cfg.goalStep)}
        {f("trunc_unit", "자동 목표 절삭 단위(원)", cfg.truncUnit)}
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold"><input type="checkbox" name="partial" defaultChecked={cfg.partial} className="h-4 w-4" /> 부분 유지 인정</label>
      </div>
      <p className="text-xs text-ink-soft">유지 판정: 전월 상승분이 생긴 달의 마감액 이상을 당월에도 유지하면 그 구간 전부 인정. ‘부분 유지 인정’을 켜면 상승 전(전전월) 대비 남아 있는 구간만큼만 인정합니다.</p>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>기준 저장</button>
        {state.error && <span className="text-sm text-danger">{state.error}</span>}
        {state.ok && <span className="text-sm text-[var(--ok-ink)]">{state.ok}</span>}
      </div>
    </form>
  );
}
