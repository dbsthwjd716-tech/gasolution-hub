"use client";

import { useId, useState, type ReactNode } from "react";

export type CheckItem = { key: string; content: ReactNode; disabled?: boolean };

// 접힌 항목: 펼치면 업체별 체크박스 + '선택한 것' / '이 항목 모두' / 줄마다 확인 버튼
export function CheckSection({
  title,
  hint,
  items,
  done,
  action,
  button = "확인했어요",
  allLabel = "이 항목 모두 확인했어요",
  empty = "오늘 확인할 것이 없습니다.",
  extra,
  defaultOpen = false,
}: {
  title: string;
  hint: string;
  items: CheckItem[];
  done?: ReactNode;
  action: (f: FormData) => Promise<void>;
  button?: string;
  allLabel?: string;
  empty?: string;
  extra?: ReactNode;
  defaultOpen?: boolean;
}) {
  const id = useId();
  const usable = items.filter((i) => !i.disabled);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const all = usable.length > 0 && usable.every((i) => picked.has(i.key));

  return (
    <details open={defaultOpen} className="glass group p-0">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4">
        <span className="text-[11px] text-ink-soft transition group-open:rotate-90">▶</span>
        <span className="font-bold">{title}</span>
        <span className={`rounded-md px-2 py-0.5 text-sm font-bold tabular-nums ${items.length ? "bg-[var(--warn-bg)] text-[var(--warn-ink)]" : "bg-[var(--ok-bg)] text-[var(--ok-ink)]"}`}>
          {items.length ? `${items.length}곳 남음` : "완료"}
        </span>
        <span className="hidden text-xs text-ink-soft sm:inline">{hint}</span>
        <span className="ml-auto text-xs text-brand group-open:hidden">펼치기</span>
        <span className="ml-auto hidden text-xs text-ink-soft group-open:inline">접기</span>
      </summary>
      <div className="border-t border-[#edf1f7] px-5 pb-4 pt-3">
        <p className="mb-2 text-xs text-ink-soft sm:hidden">{hint}</p>
        {items.length > 0 ? (
          <>
            <form action={async (f) => { await action(f); setPicked(new Set()); }}>
              <div className="sticky top-16 z-10 -mx-5 flex flex-wrap items-center gap-2 border-b border-[#edf1f7] bg-white/95 px-5 py-2 backdrop-blur">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(usable.map((i) => i.key)))} className="h-4 w-4 accent-[var(--brand)]" disabled={!usable.length} />
                  전체 선택
                </label>
                <button className="btn !px-3 !py-1.5 text-xs" disabled={!picked.size}>선택한 {picked.size}곳 {button}</button>
                <button form={`${id}-all`} className="btn btn-ghost !px-3 !py-1.5 text-xs" disabled={!usable.length}>{allLabel}</button>
              </div>
              <ul className="divide-y divide-[#edf1f7] text-sm">
                {items.map((i) => (
                  <li key={i.key} className={`flex items-start gap-3 py-2.5 ${picked.has(i.key) ? "bg-brand-soft/40" : ""}`}>
                    <input type="checkbox" name="key" value={i.key} checked={picked.has(i.key)} onChange={() => toggle(i.key)} disabled={i.disabled} className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]" aria-label="선택" />
                    <div className="min-w-0 flex-1">{i.content}</div>
                    {!i.disabled && <button form={`${id}-one-${i.key}`} className="btn btn-ghost shrink-0 !px-3 !py-1 text-xs">{button}</button>}
                  </li>
                ))}
              </ul>
            </form>
            <form id={`${id}-all`} action={action} className="hidden">
              {usable.map((i) => <input key={i.key} type="hidden" name="key" value={i.key} />)}
            </form>
            {usable.map((i) => (
              <form key={i.key} id={`${id}-one-${i.key}`} action={action} className="hidden">
                <input type="hidden" name="key" value={i.key} />
              </form>
            ))}
          </>
        ) : (
          <p className="text-sm text-ink-soft">{empty}</p>
        )}
        {done}
        {extra}
      </div>
    </details>
  );
}
