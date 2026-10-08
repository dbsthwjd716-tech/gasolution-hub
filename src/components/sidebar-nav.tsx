"use client";

import Link from "next/link";

// 왼쪽 메뉴: 회사에서 중요한 순서대로 묶음 (광고 운영 → 보고서 → 거래처 → 계약·정산 → 프로모션 → 근태 → 급여)
export type NavItem = { href: string; label: string; icon: IconName; soon?: boolean };
type Group = { key: string; label: string; items: NavItem[]; managerOnly?: boolean };

export const HOME = { href: "/home", label: "통합 홈", sub: "오늘 할 일 · 광고 현황 · 알림" };

export const GROUPS: Group[] = [
  {
    key: "ads",
    label: "광고 운영",
    items: [
      { href: "/ads/today", label: "오늘의 운영", icon: "pulse" },
      { href: "/ads", label: "비즈머니 현황", icon: "wallet" },
      { href: "/ads/spend", label: "광고비 실적", icon: "chart" },
    ],
  },
  { key: "report", label: "보고서", items: [{ href: "/reports", label: "광고 보고서", icon: "doc", soon: true }] },
  {
    key: "client",
    label: "거래처 관리",
    items: [
      { href: "/clients", label: "거래처", icon: "building" },
      { href: "/leads", label: "인입 문의", icon: "inbox" },
      { href: "/viral", label: "바이럴", icon: "megaphone" },
    ],
  },
  {
    key: "billing",
    label: "계약 · 정산 · 견적",
    items: [
      { href: "/contracts", label: "계약서", icon: "pen" },
      { href: "/billing", label: "정산서 · 견적서", icon: "receipt" },
    ],
  },
  { key: "promo", label: "프로모션", items: [{ href: "/promotions", label: "주간 일소진 프로모션", icon: "gift" }] },
  {
    key: "attend",
    label: "근태 · 연차",
    items: [
      { href: "/attendance", label: "내 근태", icon: "clock" },
      { href: "/attendance/calendar", label: "근태 달력", icon: "calendar" },
    ],
  },
  { key: "pay", label: "급여 · 인센티브", items: [{ href: "/payroll", label: "급여 · 인센티브", icon: "won" }] },
];

const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  wallet: <><path d="M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 7l11-3v3M16 13.5h1.5" /></>,
  chart: <path d="M4 20V11M10 20V5M16 20v-6M21 20H3" />,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  building: <><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 10h4a1 1 0 0 1 1 1v10M2 21h20" /><path d="M8 8h3M8 12h3M8 16h3" /></>,
  inbox: <><path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M3 13h5l1.5 3h5L16 13h5" /></>,
  megaphone: <><path d="M4 10v4a1 1 0 0 0 1 1h3l7 4V5L8 9H5a1 1 0 0 0-1 1z" /><path d="M8 15l1.5 5M19 9.5a3 3 0 0 1 0 5" /></>,
  pen: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  gift: <><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v8h14v-8M12 8v13M12 8c-2-4-6-4-6-1.5S10 8 12 8zM12 8c2-4 6-4 6-1.5S14 8 12 8z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  won: <path d="M4 6l3 12 2.5-8h5L17 18l3-12M3 11h18M3 14h18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  collapse: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M9 4v16M15 10l-2 2 2 2" /></>,
  logo: <path d="M6 17v-4M10 17V9M14 17v-6M18 17V6" />,
};
export type IconName = keyof typeof ICONS;

export function Icon({ name, className = "h-[18px] w-[18px]", stroke = 1.7 }: { name: IconName; className?: string; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

export function visibleGroups(manager: boolean) {
  // 직원에게 급여 메뉴는 '내 급여' (본인 마감 급여만)
  return GROUPS.filter((g) => manager || !g.managerOnly).map((g) =>
    !manager && g.key === "pay" ? { ...g, items: g.items.map((i) => ({ ...i, label: "내 급여" })) } : g,
  );
}

// 지금 화면에 해당하는 메뉴: 가장 길게 맞는 주소 하나만 표시
export function activeItem(path: string, manager: boolean): NavItem | undefined {
  const all: NavItem[] = [{ ...HOME, icon: "home" }, ...visibleGroups(manager).flatMap((g) => g.items)];
  return all.filter((i) => path === i.href || path.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0];
}

export function SidebarNav({ manager, path, collapsed, onNavigate }: { manager: boolean; path: string; collapsed: boolean; onNavigate: () => void }) {
  const groups = visibleGroups(manager);
  const active = activeItem(path, manager)?.href;
  const homeOn = active === HOME.href;

  return (
    <nav className="space-y-1" aria-label="주 메뉴">
      <Link
        href={HOME.href}
        onClick={onNavigate}
        title={collapsed ? HOME.label : undefined}
        aria-current={homeOn ? "page" : undefined}
        className={`group flex items-center gap-3 rounded-xl border p-2.5 transition ${
          homeOn ? "border-[#cddcff] bg-brand-soft" : "border-transparent bg-[#f4f7fd] hover:bg-brand-soft"
        } ${collapsed ? "justify-center" : ""}`}
      >
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${homeOn ? "bg-brand text-white" : "bg-white text-brand shadow-[0_1px_2px_rgba(20,33,64,.08)]"}`}>
          <Icon name="home" />
        </span>
        {!collapsed && (
          <span className="min-w-0">
            <span className={`block text-sm font-bold ${homeOn ? "text-brand" : ""}`}>{HOME.label}</span>
            <span className="block truncate text-[11px] text-ink-soft">{HOME.sub}</span>
          </span>
        )}
      </Link>

      {groups.map((g) => (
        <div key={g.key} className="!mt-3 border-t border-[#edf1f7] pt-3">
          {!collapsed && <p className="px-3 pb-1.5 text-[11px] font-semibold text-[#8a97b0]">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const on = i.href === active;
              return (
                <li key={i.href}>
                  <Link
                    href={i.soon ? "#" : i.href}
                    onClick={onNavigate}
                    aria-disabled={i.soon}
                    aria-current={on ? "page" : undefined}
                    title={collapsed ? i.label : undefined}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition ${collapsed ? "justify-center" : ""} ${
                      on
                        ? "bg-brand-soft font-semibold text-brand before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand"
                        : i.soon
                          ? "cursor-default text-[#a3aec3]"
                          : "text-[#3b4a68] hover:bg-[#f4f7fd] hover:text-ink"
                    }`}
                  >
                    <Icon name={i.icon} className={`h-[18px] w-[18px] ${on ? "" : i.soon ? "" : "text-[#7d8aa5]"}`} />
                    {!collapsed && <span className="flex-1 truncate">{i.label}</span>}
                    {!collapsed && i.soon && <span className="rounded-full bg-[#eef1f6] px-1.5 py-px text-[10px] text-ink-soft">준비 중</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
