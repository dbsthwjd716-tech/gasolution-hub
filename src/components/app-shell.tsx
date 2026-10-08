"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { activeItem, HOME, Icon, SidebarNav, visibleGroups, type NavItem } from "./sidebar-nav";

type Props = { manager: boolean; name: string; role: string; footer: ReactNode; banner?: ReactNode; children: ReactNode };

// 화면 틀: 왼쪽 흰색 메뉴 + 위쪽 막대(화면 이름 · 검색 · 내 이름)
export function AppShell({ manager, name, role, footer, banner, children }: Props) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false); // 컴퓨터: 아이콘만 보기
  const [open, setOpen] = useState(false); // 휴대폰: 메뉴 열기
  const here = activeItem(path, manager);

  return (
    <div className="min-h-screen md:flex">
      {open && <button type="button" aria-label="메뉴 닫기" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-[#142140]/30 md:hidden" />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-[#e4eaf2] bg-white transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 md:transition-[width] ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:w-[76px]" : "md:w-[248px]"}`}
      >
        <div className={`flex h-16 shrink-0 items-center gap-2.5 px-4 ${collapsed ? "md:justify-center md:px-0" : ""}`}>
          <Link href="/home" onClick={() => setOpen(false)} className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#3b7bff] to-[#2353e0] text-white shadow-[0_4px_12px_rgba(47,107,255,.35)]">
              <Icon name="logo" stroke={2.4} />
            </span>
            <span className={`min-w-0 ${collapsed ? "md:hidden" : ""}`}>
              <span className="block text-[15px] font-extrabold leading-tight tracking-tight">GA SOLUTION</span>
              <span className="block text-[11px] text-ink-soft">통합 비즈니스 플랫폼</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={`ml-auto hidden rounded-md p-1.5 text-[#8a97b0] hover:bg-[#f4f7fd] hover:text-ink md:block ${collapsed ? "md:hidden" : ""}`}
            aria-label="메뉴 접기"
            title="메뉴 접기"
          >
            <Icon name="collapse" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
          <SidebarNav manager={manager} path={path} collapsed={collapsed} onNavigate={() => setOpen(false)} />
        </div>
        <div className={`shrink-0 border-t border-[#edf1f7] p-4 ${collapsed ? "md:hidden" : ""}`}>{footer}</div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[#e4eaf2] bg-white/90 px-4 backdrop-blur md:px-8">
          <button
            type="button"
            onClick={() => (window.matchMedia("(min-width: 768px)").matches ? setCollapsed((v) => !v) : setOpen(true))}
            className="rounded-md p-1.5 text-[#5a6b8c] hover:bg-[#f4f7fd]"
            aria-label={collapsed ? "메뉴 펼치기" : "메뉴 열기"}
          >
            <Icon name="menu" />
          </button>
          <p className="truncate text-[15px] font-bold">{here?.label ?? HOME.label}</p>
          <div className="ml-auto flex items-center gap-3">
            <Search manager={manager} />
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand">{name.slice(-2)}</span>
              <span className="hidden leading-tight lg:block">
                <span className="block text-sm font-semibold">{name}</span>
                <span className="block text-[11px] text-ink-soft">{role}</span>
              </span>
            </div>
          </div>
        </header>
        {banner}
        <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-7">{children}</main>
      </div>
    </div>
  );
}

// 검색: 메뉴 이름이 맞으면 그 화면으로, 아니면 거래처·광고주에서 찾기
function Search({ manager }: { manager: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState(0);
  const items = useMemo(() => {
    const t = q.replace(/\s/g, "").toLowerCase();
    if (!t) return [];
    const menus: { href: string; label: string; sub: string; icon: NavItem["icon"] }[] = visibleGroups(manager)
      .flatMap((g) => g.items.filter((i) => !i.soon).map((i) => ({ href: i.href, label: i.label, sub: g.label, icon: i.icon })))
      .filter((i) => `${i.label}${i.sub}`.replace(/\s/g, "").toLowerCase().includes(t))
      .slice(0, 5);
    const term = encodeURIComponent(q.trim());
    return [
      ...menus,
      { href: `/clients?q=${term}`, label: `거래처에서 '${q.trim()}' 찾기`, sub: "상호 · 브랜드 · 사업자번호", icon: "building" as const },
      { href: `/ads?q=${term}`, label: `광고주에서 '${q.trim()}' 찾기`, sub: "비즈머니 현황", icon: "wallet" as const },
    ];
  }, [q, manager]);

  const go = (href: string) => {
    router.push(href);
    setQ("");
    setFocus(false);
  };

  return (
    <div className="relative hidden md:block">
      <label className="flex h-10 w-72 items-center gap-2 rounded-xl border border-[#e4eaf2] bg-[#f6f8fc] px-3 text-sm text-ink-soft focus-within:border-brand focus-within:bg-white lg:w-80">
        <Icon name="search" className="h-4 w-4" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, items.length - 1));
            else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
            else if (e.key === "Enter" && items[sel]) go(items[sel].href);
            else if (e.key === "Escape") setFocus(false);
            else return;
            e.preventDefault();
          }}
          placeholder="광고주 · 거래처 · 메뉴 검색"
          className="w-full bg-transparent text-ink outline-none placeholder:text-[#9aa6bd]"
          role="combobox"
          aria-expanded={focus && items.length > 0}
          aria-controls="global-search-list"
          aria-label="광고주 · 거래처 · 메뉴 검색"
        />
      </label>
      {focus && items.length > 0 && (
        <ul id="global-search-list" role="listbox" className="absolute right-0 top-12 z-50 w-full overflow-hidden rounded-xl border border-[#e4eaf2] bg-white py-1 shadow-[0_12px_32px_rgba(20,33,64,.12)]">
          {items.map((i, k) => (
            <li key={i.href} role="option" aria-selected={k === sel}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(i.href)}
                onMouseEnter={() => setSel(k)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${k === sel ? "bg-brand-soft" : ""}`}
              >
                <Icon name={i.icon} className="h-4 w-4 text-[#7d8aa5]" />
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                <span className="shrink-0 text-[11px] text-ink-soft">{i.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
