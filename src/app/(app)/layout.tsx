import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, ROLE_LABEL } from "@/lib/supabase/server";
import { signOut } from "../login/actions";

// 앞으로 단계별로 메뉴가 늘어남: 바이럴(2단계), 정산·계약(3), 인입 CRM(4), 광고 운영(5), 보고서(6)
const NAV = [
  { href: "/home", label: "홈" },
  { href: "/attendance", label: "근태 · 연차" },
  { href: "/clients", label: "거래처" },
  { href: "/viral", label: "바이럴" },
  { href: "/leads", label: "인입 문의" },
  { href: "/contracts", label: "계약" },
  { href: "/billing", label: "정산 · 견적" },
];
// 대표·팀장에게만 보이는 메뉴
const MANAGER_NAV = [{ href: "/payroll", label: "급여 · 인센티브" }];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, me } = await getMe();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
      <aside className="glass flex shrink-0 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 md:w-52 md:flex-col md:flex-nowrap md:items-stretch md:justify-start">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-brand">GA SOLUTION</p>
          <p className="whitespace-nowrap font-bold">통합 시스템</p>
        </div>
        <nav className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 md:mx-0 md:flex-none md:flex-col md:overflow-visible md:px-0">
          {[...NAV, ...(me && me.role !== "staff" ? MANAGER_NAV : [])].map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold hover:bg-brand-soft">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="text-sm md:mt-auto">
          {me && (
            <p className="mb-2">
              {me.name} <span className="chip chip-info">{ROLE_LABEL[me.role]}</span>
            </p>
          )}
          <form action={signOut}>
            <button className="text-xs text-ink-soft underline">로그아웃</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {me ? (
          children
        ) : (
          <div className="glass p-8">
            <h1 className="text-lg font-bold">직원 등록이 필요합니다</h1>
            <p className="mt-2 text-sm text-ink-soft">
              로그인은 됐지만 직원 목록에 없거나 퇴사 처리된 계정입니다. 대표에게 등록을 요청해 주세요.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
