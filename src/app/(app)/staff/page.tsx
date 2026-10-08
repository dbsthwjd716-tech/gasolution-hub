import { getMe, ROLE_LABEL, type Staff } from "@/lib/supabase/server";
import { ConfirmSubmit } from "../billing/panel";
import { addStaff, createLogin, resetPassword, saveJoinDate, setActive } from "./actions";
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
  const canTouch = (r: Row) => me.role === "ceo" || r.role === "staff";
  // 로그인 있는 대표가 아직 없으면 팀장이 대표 첫 로그인만 만들 수 있음 (데이터베이스도 같은 규칙)
  const ceoFirst = (r: Row) => r.role === "ceo" && !rows.some((x) => x.role === "ceo" && x.is_active && x.auth_user_id);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">직원 관리</h1>
        <p className="text-sm text-ink-soft">직원 추가 · 로그인 계정 · 퇴사 처리. 역할 변경과 공급가 보기 권한은 대표만 바꿀 수 있습니다.</p>
      </header>

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
                  <td className="px-3">
                    {r.auth_user_id ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="chip chip-ok">있음</span>
                        {canTouch(r) && r.id !== me.id && <CreateLoginButton action={resetPassword.bind(null, r.id)} label="비밀번호 초기화" confirmText={`${r.name}님 비밀번호를 새 임시 비밀번호로 바꿀까요?`} />}
                      </span>
                    ) : canTouch(r) || ceoFirst(r) ? <CreateLoginButton action={createLogin.bind(null, r.id)} /> : <span className="text-xs text-ink-soft">대표만 만들 수 있음</span>}
                  </td>
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
