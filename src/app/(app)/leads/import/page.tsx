import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { fetchLegacyLeads } from "@/lib/legacy-crm";
import { importLegacyLeads } from "../actions";
import { ImportForm } from "./form";

export default async function LeadsImport() {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">예전 CRM 옮기기는 대표·팀장만 할 수 있습니다.</p>;
  const [{ data, error }, { data: done }] = await Promise.all([
    fetchLegacyLeads(),
    supabase.from("leads").select("source_ref").like("source_ref", "crm:%"),
  ]);
  const doneSet = new Set((done ?? []).map((d) => d.source_ref));
  const leads = data?.leads ?? [];
  const fresh = leads.filter((l) => !doneSet.has(`crm:${l.id}`));
  const owners = new Map<string, number>();
  for (const l of fresh) owners.set(l.owner || "미배정", (owners.get(l.owner || "미배정") ?? 0) + 1);

  return (
    <div className="space-y-4">
      <Link href="/leads" className="text-sm text-ink-soft hover:text-brand">← 인입 문의</Link>
      <header>
        <h1 className="text-2xl font-bold">예전 CRM에서 옮기기</h1>
        <p className="text-sm text-ink-soft">
          예전 인입 CRM의 문의·상담 기록·상태 변경 이력을 그대로 옮겨 옵니다. 이미 옮긴 문의는 건너뛰므로 여러 번 눌러도 됩니다
          (예전 CRM을 같이 쓰는 동안 새로 들어온 문의만 추가). 예전 CRM 데이터는 읽기만 합니다.
        </p>
      </header>
      {error ? (
        <p className="glass p-4 text-sm text-danger">{error}</p>
      ) : (
        <section className="glass space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><p className="text-xs text-ink-soft">예전 CRM 문의</p><p className="text-xl font-bold tabular-nums">{leads.length}건</p></div>
            <div><p className="text-xs text-ink-soft">이미 옮김</p><p className="text-xl font-bold tabular-nums">{leads.length - fresh.length}건</p></div>
            <div><p className="text-xs text-ink-soft">새로 옮길 문의</p><p className="text-xl font-bold tabular-nums">{fresh.length}건</p></div>
          </div>
          {fresh.length > 0 && (
            <p className="text-xs text-ink-soft">
              담당별: {[...owners.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(" · ")}
              {fresh.length > 0 && <> · 기간 {fresh[0].inquiry_at.slice(0, 10)} ~ {fresh[fresh.length - 1].inquiry_at.slice(0, 10)}</>}
            </p>
          )}
          <ul className="text-xs text-ink-soft">
            <li>· 담당은 같은 이름의 직원에 연결합니다. &ldquo;윤소정&gt;박주용&rdquo;처럼 바뀐 기록은 마지막 사람으로 연결하고 원문은 &lsquo;예전 담당 기록&rsquo;에 남깁니다.</li>
            <li>· 통합 시스템에 없는 퇴사 직원 이름은 퇴사 직원(로그인 없음)으로 추가합니다.</li>
            <li>· 예상 계약금액·계약금액·실패 사유는 메모 끝에 붙입니다.</li>
          </ul>
          <ImportForm action={importLegacyLeads} pending={fresh.length} />
        </section>
      )}
    </div>
  );
}
