import { getMe, ROLE_LABEL, type Staff } from "@/lib/supabase/server";
import { ConfirmSubmit } from "../billing/panel";
import { addStaff, createLogin, saveJoinDate, setActive } from "./actions";
import { AddStaffForm, CreateLoginButton, JoinDateForm } from "./forms";

type Row = Staff & { is_active: boolean; auth_user_id: string | null; staff_hr: { join_date: string | null } | { join_date: string | null }[] | null };

// 직원 관리: 대표·팀장. 팀장은 일반 직원 추가·퇴사·로그인 계정, 역할·공급가 권한은 대표만
export default async function StaffPage() {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">직원 관리는 대표·팀장만 볼 수 있습니다.</p>;
  const { data } = await supabase.from("staff").select("id,name,email,role,can_view_cost,is_active,auth_user_id,staff_hr(join_date)").order("is_active", { ascending: false }).order("name");
  const rows = (data ?? []) as Row[];
  const join = (r: Row) => (Array.isArray(r.staff_hr) ? r.staff_hr[0]?.join_date : r.staff_hr?.join_date) ?? null;
  const active = rows.filter((r) => r.is_active);
  const left = rows.filter((r) => !r.is_active);
  const ready = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const canTouch = (r: Row) => me.role === "ceo" || r.role === "staff";
  const noLogin = active.filter((r) => !r.auth_user_id).length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">직원 관리</h1>
        <p className="text-sm text-ink-soft">직원 추가 · 로그인 계정 · 퇴사 처리. 역할 변경과 공급가 보기 권한은 대표만 바꿀 수 있습니다.</p>
      </header>

      {!ready && noLogin > 0 && (
        <section className="glass border-[#f0d48a] bg-[#fffbf0] p-4 text-sm">
          <p className="font-bold text-[#7a5200]">로그인 계정이 없는 직원 {noLogin}명</p>
          <p className="mt-1 text-ink-soft">여기서 바로 계정을 만들려면 Supabase의 서비스 키를 Vercel 환경변수 <b>SUPABASE_SERVICE_ROLE_KEY</b>로 한 번 넣어 주세요. 그 전에는 대표가 Supabase에서 직원 이메일로 사용자를 만들면 자동으로 연결됩니다.</p>
        </section>
      )}

      <section className="glass p-4">
        <h2 className="mb-3 text-sm font-bold">직원 등록</h2>
        <AddStaffForm action={addStaff} ceo={me.role === "ceo"} />
      </section>

      <section className="glass p-4">
        <h2 className="text-sm font-bold">재직 중 {active.length}명</h2>
        <div className="-mx-4 mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-y border-[#edf1f7] bg-[#f8fafd] text-left text-xs text-ink-soft">
                <th className="px-4 py-2.5 font-medium">이름</th><th className="px-3 font-medium">역할</th><th className="px-3 font-medium">이메일 (아이디)</th>
                <th className="px-3 font-medium">입사일</th><th className="px-3 font-medium">로그인</th><th className="px-4 text-right font-medium">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf1f7]">
              {active.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-semibold">{r.name}{r.can_view_cost && r.role === "staff" && <span className="chip chip-info ml-1.5 !text-[10.5px]">공급가 보기</span>}</td>
                  <td className="px-3">{ROLE_LABEL[r.role]}</td>
                  <td className="px-3 text-xs">{r.email || <span className="text-danger">없음</span>}</td>
                  <td className="px-3">{canTouch(r) ? <JoinDateForm action={saveJoinDate.bind(null, r.id)} value={join(r)} /> : <span className="text-xs">{join(r) ?? "-"}</span>}</td>
                  <td className="px-3">{r.auth_user_id ? <span className="chip chip-ok">있음</span> : <CreateLoginButton action={createLogin.bind(null, r.id)} ready={ready} />}</td>
                  <td className="px-4 text-right">
                    {canTouch(r) && r.id !== me.id && <ConfirmSubmit action={setActive.bind(null, r.id, false)} label="퇴사 처리" confirmText={`${r.name}님을 퇴사 처리할까요? 로그인이 막히고 담당 기록은 그대로 남습니다.`} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {left.length > 0 && (
        <section className="glass p-4">
          <h2 className="text-sm font-bold text-ink-soft">퇴사 {left.length}명</h2>
          <ul className="mt-2 divide-y divide-[#edf1f7] text-sm">
            {left.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span className="text-ink-soft">{r.name} · {ROLE_LABEL[r.role]}{r.email ? ` · ${r.email}` : ""}</span>
                {canTouch(r) && <form action={setActive.bind(null, r.id, true)}><button className="text-xs text-brand hover:underline">복직</button></form>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
