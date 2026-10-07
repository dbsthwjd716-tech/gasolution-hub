import Link from "next/link";
import { getMe } from "@/lib/supabase/server";

// 근태 화면 위쪽 메뉴. 결재·현황·설정은 대표·팀장만
export default async function AttendanceLayout({ children }: LayoutProps<"/attendance">) {
  const { supabase, me } = await getMe();
  const manager = !!me && me.role !== "staff";
  let waiting = 0;
  if (manager) {
    const [a, b, c, d] = await Promise.all([
      supabase.from("leave_requests").select("id", { count: "exact", head: true }).in("status", ["pending", "first_approved"]),
      supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "approved").not("cancel_status", "is", null),
      supabase.from("attendance_exceptions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("attendance_correction_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    waiting = (a.count ?? 0) + (b.count ?? 0) + (c.count ?? 0) + (d.count ?? 0);
  }
  const tabs = [
    { href: "/attendance", label: "내 근태" },
    { href: "/attendance/calendar", label: "달력" },
    ...(manager
      ? [
          { href: "/attendance/approvals", label: waiting ? `결재 ${waiting}` : "결재" },
          { href: "/attendance/status", label: "근태 현황" },
          { href: "/attendance/settings", label: "설정" },
        ]
      : []),
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
