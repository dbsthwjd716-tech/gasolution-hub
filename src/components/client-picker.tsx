"use client";

import { useMemo, useState } from "react";

export type PickClient = { id: string; company_name: string; business_number?: string | null; note?: string };

const norm = (v: string) => v.toLowerCase().replace(/\s|\(주\)|㈜|주식회사|-/g, "");

// 거래처 고르기: 목록을 스크롤하지 않고 이름·사업자번호 일부를 입력해 찾음
export function ClientPicker({ id, name, clients, value, onChange, required, disabled, placeholder = "거래처 이름 또는 사업자번호로 찾기" }: {
  id?: string;
  name: string;
  clients: PickClient[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const picked = clients.find((c) => c.id === value);
  const matches = useMemo(() => {
    const n = norm(q);
    const list = n ? clients.filter((c) => norm(c.company_name).includes(n) || (c.business_number ?? "").replace(/-/g, "").includes(q.replace(/-/g, "").trim())) : clients;
    return list.slice(0, 30);
  }, [q, clients]);

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />
      {picked && !open ? (
        <div className="field flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{picked.company_name}{picked.note ? <span className="ml-1 text-xs font-normal text-ink-soft">{picked.note}</span> : null}</span>
          {!disabled && (
            <button type="button" className="shrink-0 text-xs text-brand underline" onClick={() => { setQ(""); setOpen(true); }}>
              바꾸기
            </button>
          )}
        </div>
      ) : (
        <>
          <input
            id={id}
            value={q}
            disabled={disabled}
            required={required && !value}
            autoFocus={open && !!picked}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (matches[0]) { onChange(matches[0].id); setOpen(false); }
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={placeholder}
            className="field"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${name}-options`}
            aria-label="거래처 검색"
          />
          {open && (
            <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[var(--glass-border)] bg-white shadow-lg" role="listbox" id={`${name}-options`}>
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onChange(c.id); setQ(""); setOpen(false); }}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-brand-soft ${c.id === value ? "bg-brand-soft" : ""}`}
                  >
                    {c.company_name}
                    {(c.business_number || c.note) && <span className="ml-2 text-xs text-ink-soft tabular-nums">{c.business_number ?? ""}{c.note ? ` ${c.note}` : ""}</span>}
                  </button>
                </li>
              ))}
              {!matches.length && <li className="px-3 py-2 text-sm text-ink-soft">“{q}”와 맞는 거래처가 없습니다</li>}
              {!q && clients.length > 30 && <li className="px-3 py-1.5 text-xs text-ink-soft">이름을 입력하면 {clients.length}곳 중에서 찾습니다</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
