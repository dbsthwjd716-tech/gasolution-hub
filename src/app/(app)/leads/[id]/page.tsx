import Link from "next/link";
import { notFound } from "next/navigation";
import { followUp, formatKST, forwardText, normalizeCompany, STATUS_CHIP, type LeadStatus } from "@/lib/leads";
import { LEAD_COLUMNS, today, type LeadRow } from "@/lib/leads-data";
import { getMe } from "@/lib/supabase/server";
import { ConfirmSubmit, CopyButton } from "../../billing/panel";
import { addLeadActivity, deleteLead, linkLeadClient, setLeadOwner, setLeadStatus, updateLead } from "../actions";
import { ActivityForm, ClientLinkForm, LeadForm, OwnerForm, StatusForm } from "../forms";

type Activity = { id: number; activity_type: string; occurred_at: string; content: string; actor: { name: string } | null };
const AUTO = ["상태 변경", "담당 변경", "등록"];

export default async function LeadDetail(props: PageProps<"/leads/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  const { data: l } = await supabase.from("leads_view").select(LEAD_COLUMNS).eq("id", id).maybeSingle<LeadRow>();
  if (!l) notFound();
  const [{ data: acts }, { data: staff }, { data: clients }, { data: same }] = await Promise.all([
    supabase.from("lead_activities").select("id,activity_type,occurred_at,content,actor:staff(name)").eq("lead_id", id).order("occurred_at", { ascending: false }).order("id", { ascending: false }).returns<Activity[]>(),
    supabase.from("staff").select("id,name").eq("is_active", true).order("name"),
    supabase.from("clients").select("id,company_name").order("company_name"),
    l.phone_digits
      ? supabase.from("leads").select("id,company_name,inquiry_at,status").eq("phone_digits", l.phone_digits).neq("id", id).limit(5)
      : Promise.resolve({ data: [] as { id: string; company_name: string; inquiry_at: string; status: string }[] }),
  ]);

  const isManager = me?.role === "ceo" || me?.role === "lead";
  const canEdit = !!me && (isManager || l.staff_id === me.id || (!l.staff_id && l.created_by === me.id));
  const f = followUp(l, today());
  const suggested = (clients ?? []).find((c) => normalizeCompany(c.company_name) === normalizeCompany(l.company_name))?.id ?? null;

  return (
    <div className="space-y-4">
      <Link href="/leads" className="text-sm text-ink-soft hover:text-brand">← 인입 문의</Link>
      {sp.created === "1" && <p className="glass p-3 text-sm text-[var(--ok-ink)]">등록했습니다. 오른쪽 &lsquo;전달 문구 복사&rsquo;로 담당에게 알려 주세요.</p>}
      <header className="glass flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h1 className="text-xl font-bold">{l.company_name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span className={`chip ${STATUS_CHIP[l.status as LeadStatus]}`}>{l.status}</span>
            <span>{formatKST(l.inquiry_at)}</span>
            <span>담당 {l.staff_name ?? "미배정"}</span>
            {f.needed && <span className="chip chip-warn">연락 필요 · {f.reason}</span>}
            {l.client_id && <Link href={`/clients/${l.client_id}`} className="chip chip-ok">거래처 · {l.client_name}</Link>}
          </p>
          {l.legacy_owner && <p className="mt-1 text-xs text-ink-soft">예전 담당 기록: {l.legacy_owner}</p>}
        </div>
        {!canEdit && <span className="chip chip-muted">보기 전용 · 상담 기록은 누구나 남길 수 있습니다</span>}
      </header>

      {!!same?.length && (
        <p className="glass p-3 text-sm">
          <span className="chip chip-warn mr-2">같은 연락처</span>
          {same.map((x, i) => (
            <span key={x.id}>{i > 0 && ", "}<Link href={`/leads/${x.id}`} className="underline">{x.company_name} ({x.inquiry_at.slice(0, 10)} · {x.status})</Link></span>
          ))}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <section className="glass p-5">
            <h2 className="mb-3 font-bold">상담 기록</h2>
            <ActivityForm action={addLeadActivity.bind(null, id)} status={l.status} />
            <ol className="mt-5 space-y-3 border-t border-[var(--glass-border)] pt-4">
              {(acts ?? []).map((a) => (
                <li key={a.id} className={AUTO.includes(a.activity_type) ? "text-xs text-ink-soft" : "text-sm"}>
                  <p className="text-xs text-ink-soft">
                    {formatKST(a.occurred_at)} · <span className={AUTO.includes(a.activity_type) ? "" : "chip chip-info"}>{a.activity_type}</span> · {a.actor?.name ?? "시스템"}
                  </p>
                  <p className="whitespace-pre-wrap">{a.content}</p>
                </li>
              ))}
              {!acts?.length && <li className="text-sm text-ink-soft">아직 기록이 없습니다.</li>}
            </ol>
          </section>
          <section className="glass p-5">
            <h2 className="mb-4 font-bold">문의 정보</h2>
            <LeadForm action={updateLead.bind(null, id)} initial={l} submitLabel="저장" readOnly={!canEdit} />
          </section>
        </div>

        <div className="space-y-4">
          <section className="glass space-y-2 p-5">
            <h2 className="font-bold">진행</h2>
            {canEdit ? <StatusForm action={setLeadStatus.bind(null, id)} status={l.status} nextOn={l.next_contact_on} /> : <p className="text-sm text-ink-soft">상태는 담당자·팀장이 바꿉니다.</p>}
            {me && <OwnerForm action={setLeadOwner.bind(null, id)} staff={staff ?? []} current={l.staff_id} canAssign={isManager} selfId={me.id} />}
            <CopyButton text={forwardText(l)} label="담당에게 보낼 전달 문구 복사" />
          </section>
          <section className="glass space-y-2 p-5">
            <h2 className="font-bold">거래처</h2>
            {l.client_id ? (
              <p className="text-sm">
                <Link href={`/clients/${l.client_id}`} className="text-brand underline">{l.client_name}</Link>에 연결됨.
                <Link href={`/contracts/new?client=${l.client_id}`} className="ml-2 text-brand underline">계약 등록</Link>
              </p>
            ) : canEdit ? (
              <>
                <p className="text-xs text-ink-soft">계약이 진행되면 거래처로 연결하세요. 새로 만들면 사업자번호 없는 임시 거래처로 생기고, 거래처 화면에서 정보를 채우면 됩니다.</p>
                <ClientLinkForm action={linkLeadClient.bind(null, id)} clients={clients ?? []} suggested={suggested} />
              </>
            ) : (
              <p className="text-sm text-ink-soft">아직 연결된 거래처가 없습니다.</p>
            )}
          </section>
          {isManager && (
            <section className="glass p-5">
              <ConfirmSubmit action={deleteLead.bind(null, id)} label="문의 삭제" confirmText={`${l.company_name} 문의를 지울까요? 상담 기록도 함께 지워지고 되돌릴 수 없습니다.`} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
