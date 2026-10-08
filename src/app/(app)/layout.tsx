import { redirect } from "next/navigation";
import { getMe, ROLE_LABEL } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, me } = await getMe();
  if (!user) redirect("/login");

  const footer = (
    <div className="flex items-center justify-between gap-2 text-sm">
      <p className="min-w-0 truncate">
        <span className="font-semibold">{me?.name ?? user.email}</span>
        {me && <span className="chip chip-info ml-1.5 !px-2 !text-[11px]">{ROLE_LABEL[me.role]}</span>}
      </p>
      <form action={signOut}>
        <button className="rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-[#f4f7fd] hover:text-ink">로그아웃</button>
      </form>
    </div>
  );

  return (
    <AppShell manager={!!me && me.role !== "staff"} name={me?.name ?? ""} role={me ? ROLE_LABEL[me.role] : ""} footer={footer}>
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
    </AppShell>
  );
}
