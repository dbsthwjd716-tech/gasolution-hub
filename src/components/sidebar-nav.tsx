"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

// 왼쪽 메뉴: 회사에서 중요한 순서대로 묶음 (광고 운영 → 보고서 → 거래처 → 계약·정산 → 프로모션 → 근태 → 급여)
type Item = { href: string; label: string; soon?: boolean };
type Group = { key: string; label: string; icon: keyof typeof ICONS; items: Item[]; managerOnly?: boolean };

const GROUPS: Group[] = [
  { key: "home", label: "홈", icon: "home", items: [{ href: "/home", label: "오늘 할 일" }] },
  {
    key: "ads",
    label: "광고 운영",
    icon: "chart",
    items: [
      { href: "/ads/today", label: "오늘의 운영" },
      { href: "/ads", label: "비즈머니 현황" },
      { href: "/ads/spend", label: "광고비 실적" },
    ],
  },
  { key: "report", label: "보고서", icon: "doc", items: [{ href: "/reports", label: "광고 보고서", soon: true }] },
  {
    key: "client",
    label: "거래처 관리",
    icon: "users",
    items: [
      { href: "/clients", label: "거래처" },
      { href: "/leads", label: "인입 문의" },
      { href: "/viral", label: "바이럴" },
    ],
  },
  {
    key: "billing",
    label: "계약 · 정산 · 견적",
    icon: "pen",
    items: [
      { href: "/contracts", label: "계약서" },
      { href: "/billing", label: "정산서 · 견적서" },
    ],
  },
  { key: "promo", label: "프로모션", icon: "gift", items: [{ href: "/promotions", label: "주간 일소진 프로모션" }] },
  { key: "attend", label: "근태 · 연차", icon: "clock", items: [{ href: "/attendance", label: "내 근태" }, { href: "/attendance/calendar", label: "근태 달력" }] },
  { key: "pay", label: "급여 · 인센티브", icon: "won", managerOnly: true, items: [{ href: "/payroll", label: "급여 · 인센티브" }] },
];

const ICONS = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.7 2.5 3 5.2" /></>,
  pen: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></>,
  gift: <><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v8h14v-8M12 8v13M12 8c-2-4-6-4-6-1.5S10 8 12 8zM12 8c2-4 6-4 6-1.5S14 8 12 8z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  won: <><path d="M4 6l3 12 2.5-8h5L17 18l3-12M3 11h18M3 14h18" /></>,
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

// 지금 화면에 해당하는 메뉴: 가장 길게 맞는 주소 하나만 표시
function activeHref(path: string, all: Item[]) {
  return all.filter((i) => path === i.href || path.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function SidebarNav({ manager }: { manager: boolean }) {
  const path = usePathname();
  const groups = GROUPS.filter((g) => manager || !g.managerOnly);
  const active = activeHref(path, groups.flatMap((g) => g.items));
  const [open, setOpen] = useState(false); // 휴대폰에서 메뉴 펼치기

  return (
    <>
      <div className="md:hidden">
        <button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-ghost !px-3 !py-1.5 text-xs" aria-expanded={open}>
          {open ? "메뉴 닫기" : "메뉴"}
        </button>
      </div>
      <nav className={`${open ? "block" : "hidden"} w-full space-y-3 md:block`}>
        {groups.map((g) => {
          const here = g.items.some((i) => i.href === active);
          if (g.items.length === 1) {
            const i = g.items[0];
            return (
              <Link
                key={g.key}
                href={i.soon ? "#" : i.href}
                onClick={() => setOpen(false)}
                aria-disabled={i.soon}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  here ? "bg-brand text-white shadow-sm" : i.soon ? "cursor-default text-ink-soft/70" : "hover:bg-brand-soft"
                }`}
              >
                <Icon name={g.icon} />
                <span className="flex-1">{g.label}</span>
                {i.soon && <span className="rounded-full bg-[#eef1f6] px-1.5 text-[10px] text-ink-soft">준비 중</span>}
              </Link>
            );
          }
          return (
            <div key={g.key}>
              <p className={`flex items-center gap-2.5 px-3 pb-1 text-xs font-bold ${here ? "text-brand" : "text-ink-soft"}`}>
                <Icon name={g.icon} />
                {g.label}
              </p>
              <div className="ml-[21px] space-y-0.5 border-l border-[var(--glass-border)] pl-2">
                {g.items.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-md px-2.5 py-1.5 text-sm transition ${i.href === active ? "bg-brand font-semibold text-white" : "hover:bg-brand-soft"}`}
                  >
                    {i.label}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </>
  );
}
