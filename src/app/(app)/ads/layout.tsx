import Link from "next/link";

// 광고 운영 위쪽 메뉴. 데이터는 예전 네이버 대시보드가 매일 아침 모은 것을 읽어 옴 (1차)
export default function AdsLayout({ children }: LayoutProps<"/ads">) {
  const tabs = [
    { href: "/ads/today", label: "오늘의 운영" },
    { href: "/ads", label: "비즈머니 현황" },
    { href: "/ads/spend", label: "광고비 실적" },
  ];
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="glass rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-brand-soft">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
