import { redirect } from "next/navigation";
import { getMe, ROLE_LABEL } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import { AppShell } from "@/components/app-shell";
import { startPreview, stopPreview } from "./preview-actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, me, viewer, preview, supabase } = await getMe();
  if (!user) redirect("/login");
  const canPreview = !!viewer && viewer.role !== "staff";
  const staff = canPreview && !preview
    ? ((await supabase.from("staff").select("id,name").eq("is_active", true).eq("role", "staff").order("name")).data ?? [])
    : [];

  const footer = (
    <div className="space-y-3">
      {canPreview && !preview && staff.length > 0 && (
        <form action={startPreview} className="space-y-1.5">
          <p className="text-[11px] font-semibold text-[#8a97b0]">직원 화면으로 보기</p>
          <div className="flex gap-1.5">
            <select name="staff_id" className="field !py-1.5 text-xs" aria-label="미리 볼 직원">
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn btn-ghost !px-2.5 !py-1.5 text-xs">보기</button>
          </div>
        </form>
      )}
      <div className="flex items-center justify-between gap-2 text-sm">
        <p className="min-w-0 truncate">
          <span className="font-semibold">{viewer?.name ?? user.email}</span>
          {viewer && <span className="chip chip-info ml-1.5 !px-2 !text-[11px]">{ROLE_LABEL[viewer.role]}</span>}
        </p>
        <span className="flex items-center">
          <a href="/account" className="rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-[#f4f7fd] hover:text-ink">비밀번호</a>
          <form action={signOut}>
            <button className="rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-[#f4f7fd] hover:text-ink">로그아웃</button>
          </form>
        </span>
      </div>
    </div>
  );

  const banner = preview && me ? (
    <div className="sticky top-16 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#f3d48a] bg-[#fff6dd] px-4 py-2 text-sm text-[#7a5200] md:px-8">
      <span className="font-bold">{me.name}님 화면으로 보는 중</span>
      <span className="text-xs">{me.name}님 권한 그대로 보입니다. 미리보기 중에는 저장·변경이 막혀 있습니다.</span>
      <form action={stopPreview} className="ml-auto">
        <button className="rounded-lg bg-[#7a5200] px-3 py-1 text-xs font-semibold text-white hover:brightness-110">미리보기 끝내기</button>
      </form>
    </div>
  ) : null;

  return (
    <AppShell manager={!!me && me.role !== "staff"} name={me?.name ?? ""} role={me ? (preview ? "직원 화면 미리보기" : ROLE_LABEL[me.role]) : ""} footer={footer} banner={banner}>
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
