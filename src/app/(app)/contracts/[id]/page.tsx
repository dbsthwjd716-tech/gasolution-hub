import Link from "next/link";
import { notFound } from "next/navigation";
import { CONTRACT_STATUS, markupText, won } from "@/lib/billing-calc";
import { loadBillingClients, loadStaffNames } from "@/lib/billing-data";
import { signedLinks } from "@/lib/storage";
import { getMe } from "@/lib/supabase/server";
import { changeContractStatus, updateContract } from "../actions";
import { ContractForm, RejectForm, SignedUploadForm, StepButton } from "../forms";

export default async function ContractDetail(props: PageProps<"/contracts/[id]">) {
  const { id } = await props.params;
  const { supabase, me } = await getMe();
  const { data: k } = await supabase
    .from("contracts")
    .select("*, client:clients(company_name), staff:staff!contracts_staff_id_fkey(name), completer:staff!contracts_completed_by_fkey(name)")
    .eq("id", id)
    .maybeSingle();
  if (!k) notFound();
  const [clients, staff, links, { data: docs }] = await Promise.all([
    loadBillingClients(supabase),
    loadStaffNames(supabase),
    signedLinks(supabase, [k.signed_file_path]),
    supabase
      .from("billing_documents")
      .select("id,document_date,period_start,period_end,total_amount,status")
      .eq("contract_id", id)
      .order("document_date", { ascending: false })
      .limit(24),
  ]);
  const isManager = me?.role === "ceo" || me?.role === "lead";
  const isOwner = !!me && k.staff_id === me.id;
  const locked = ["active", "ended"].includes(k.status);
  const canEdit = isManager || (isOwner && !locked);
  const step = changeContractStatus.bind(null, id);
  const st = CONTRACT_STATUS[k.status];

  return (
    <div className="space-y-4">
      <Link href="/contracts" className="text-sm text-ink-soft hover:text-brand">← 계약 목록</Link>
      <header className="glass flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h1 className="text-xl font-bold">{k.client?.company_name} 계약</h1>
          <p className="mt-1 text-sm text-ink-soft">
            <span className={`chip ${st?.cls}`}>{st?.label}</span>
            <span className="ml-2">{markupText(k.markup_type, k.markup_rate, k.markup_fixed)} · VAT {k.vat_mode === "included" ? "포함" : "별도"}{Number(k.min_fee) ? ` · 최소 ${won(k.min_fee)}` : ""}</span>
            <span className="ml-2">담당 {k.staff?.name ?? "-"}</span>
            {k.completer && <span className="ml-2">완료 처리 {k.completer.name}</span>}
          </p>
          {k.status === "rejected" && k.rejection_reason && <p className="mt-2 text-sm text-danger">반려 사유: {k.rejection_reason}</p>}
        </div>
        {!canEdit && <span className="chip chip-muted">{locked ? "완료된 계약 · 대표·팀장만 수정" : "보기 전용 · 담당자나 팀장만 수정"}</span>}
      </header>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="glass p-5">
          <h2 className="mb-4 font-bold">계약 조건</h2>
          <ContractForm
            action={updateContract.bind(null, id)}
            clients={clients}
            staff={staff.filter((x) => x.is_active || x.id === k.staff_id)}
            canPickStaff={isManager}
            initial={{ ...k, markup_rate: Number(k.markup_rate), markup_fixed: Number(k.markup_fixed), min_fee: Number(k.min_fee) }}
            submitLabel="저장"
            readOnly={!canEdit}
          />
        </section>

        <div className="space-y-4">
          <section className="glass space-y-3 p-5">
            <h2 className="font-bold">진행</h2>
            {k.signed_file_path && (
              <p className="text-sm">
                서명본: {links[k.signed_file_path] ? <a href={links[k.signed_file_path]} target="_blank" rel="noreferrer" className="text-brand underline">{k.signed_file_name ?? "열기"}</a> : k.signed_file_name}
              </p>
            )}
            {(isOwner || isManager) && ["draft", "rejected", "on_hold"].includes(k.status) && (
              <StepButton action={step} step="signing" label="서명 진행중으로 표시" ghost />
            )}
            {(isOwner || isManager) && !locked && !isManager && (
              <div className="space-y-1">
                <p className="text-xs text-ink-soft">광고주 서명본을 올려 두면 대표·팀장이 확인 후 완료 처리합니다.</p>
                <SignedUploadForm action={step} step="upload_signed" label="서명본 올리기" />
              </div>
            )}
            {isManager && !locked && (
              <>
                <div className="space-y-1">
                  <p className="text-xs text-ink-soft">서명본 PDF를 올리고 완료 (이미 올라와 있으면 파일 없이 눌러도 됩니다)</p>
                  <SignedUploadForm action={step} step="complete_signed" label="서명본 확인 · 계약 완료" />
                </div>
                <StepButton action={step} step="complete_no_document" label="계약서 없이 완료" ghost confirmText="계약서 없이 계약 완료로 처리할까요?" />
                <StepButton action={step} step="on_hold" label="보류" ghost />
                <RejectForm action={step} />
              </>
            )}
            {isManager && k.status === "active" && (
              <>
                <StepButton action={step} step="ended" label="계약 종료" ghost confirmText="계약을 종료할까요? 이후 정산서에 자동으로 들어가지 않습니다." />
                <StepButton action={step} step="draft" label="다시 작성중으로 (조건 수정)" ghost confirmText="계약 완료를 풀고 작성중으로 돌릴까요?" />
              </>
            )}
            {isManager && k.status === "ended" && <StepButton action={step} step="draft" label="다시 작성중으로" ghost />}
          </section>

          <section className="glass p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">이 계약으로 만든 정산</h2>
              {k.status === "active" && <Link href={`/billing/new?type=settlement&client=${k.client_id}`} className="text-sm text-brand underline">정산서 작성</Link>}
            </div>
            <ul className="space-y-1 text-sm">
              {(docs ?? []).map((d) => (
                <li key={d.id} className="flex justify-between">
                  <Link href={`/billing/${d.id}`} className="hover:text-brand">{d.period_start ? `${d.period_start} ~ ${d.period_end}` : d.document_date}</Link>
                  <span className="tabular-nums">{won(d.total_amount)}</span>
                </li>
              ))}
              {!docs?.length && <li className="text-ink-soft">아직 없습니다.</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
