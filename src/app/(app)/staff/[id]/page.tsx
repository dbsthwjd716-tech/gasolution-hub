import Link from "next/link";
import { getMe, ROLE_LABEL, type Staff } from "@/lib/supabase/server";
import { StaffDocsPanel } from "../docs-panel";

// 직원 한 명의 서류함 (대표·팀장)
export default async function StaffDetail(props: PageProps<"/staff/[id]">) {
  const { id } = await props.params;
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">직원 서류는 대표·팀장만 볼 수 있습니다. 본인 서류는 「내 계정」에서 볼 수 있습니다.</p>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <p className="glass p-5 text-sm">직원을 찾을 수 없습니다.</p>;
  const { data: s } = await supabase.from("staff").select("id,name,email,role,can_view_cost,is_active").eq("id", id).maybeSingle<Staff & { is_active: boolean }>();
  if (!s) return <p className="glass p-5 text-sm">직원을 찾을 수 없습니다.</p>;
  return (
    <div className="max-w-4xl space-y-4">
      <header>
        <Link href="/staff" className="text-xs text-brand underline">← 직원 관리</Link>
        <h1 className="mt-1 text-2xl font-bold">{s.name} <span className="text-base font-normal text-ink-soft">{ROLE_LABEL[s.role]}{s.is_active ? "" : " · 퇴사"}</span></h1>
        <p className="text-sm text-ink-soft">근로계약서 · 비밀유지서약서 · 통장사본 · 주민등록등본 · 신분증(입사 후), 자격증(취득 시), 퇴직사유서(퇴사 시)</p>
      </header>
      <StaffDocsPanel supabase={supabase} staffId={s.id} active={s.is_active} manager self={s.id === me.id} />
    </div>
  );
}
