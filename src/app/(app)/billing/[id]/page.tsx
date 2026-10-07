import Link from "next/link";
import { notFound } from "next/navigation";
import { DOC_TYPE_LABEL, requestText, statusLabel, STATUS_LABEL, won, type BillingStatus, type DocType } from "@/lib/billing-calc";
import { formatBizNo } from "@/lib/bizno";
import { loadActiveContracts, loadBillingClients, loadSuppliers } from "@/lib/billing-data";
import { signedLinks } from "@/lib/storage";
import { getMe } from "@/lib/supabase/server";
import { changeBillingStatus, deleteBilling, removeBillingFile, saveBilling, setBillingPayment } from "../actions";
import { BillingForm } from "../forms";
import { ConfirmSubmit, CopyButton, PaymentForm, RejectForm, StepButton } from "../panel";

export default async function BillingDetail(props: PageProps<"/billing/[id]">) {
  const { id } = await props.params;
  const { supabase, me } = await getMe();
  const { data: d } = await supabase
    .from("billing_documents")
    .select(
      "*, staff:staff!billing_documents_staff_id_fkey(name), lead:staff!billing_documents_lead_approved_by_fkey(name), ceo:staff!billing_documents_approved_by_fkey(name), issuer:staff!billing_documents_issued_by_fkey(name), billing_items(*), billing_files(*), billing_logs(id,from_status,to_status,reason,created_at,actor:staff(name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!d) notFound();

  const docType = d.doc_type as DocType;
  const status = d.status as BillingStatus;
  const role = me?.role;
  const isManager = role === "ceo" || role === "lead";
  const isOwner = !!me && d.staff_id === me.id;
  const canEdit = (isManager || isOwner) && ["draft", "requested", "rejected"].includes(status);
  const items = [...(d.billing_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const files = d.billing_files ?? [];
  const logs = [...(d.billing_logs ?? [])].sort((a, b) => a.id - b.id);

  const [clients, contracts, suppliers, links, { data: reg }] = await Promise.all([
    loadBillingClients(supabase),
    loadActiveContracts(supabase),
    loadSuppliers(supabase),
    signedLinks(supabase, files.map((f: { storage_path: string }) => f.storage_path)),
    supabase.from("client_documents").select("id").eq("client_id", d.client_id).eq("document_type", "business_registration").limit(1),
  ]);
  if (d.contract_id && !contracts.some((k) => k.id === d.contract_id)) {
    const { data: k } = await supabase.from("contracts").select("id,client_id,start_date,end_date,contract_date,markup_type,markup_rate,markup_fixed,min_fee,vat_mode").eq("id", d.contract_id).maybeSingle();
    if (k) contracts.push({ ...k, media: [], markup_rate: Number(k.markup_rate), markup_fixed: Number(k.markup_fixed), min_fee: Number(k.min_fee) });
  }
  const supplier = suppliers.find((x) => x.code === d.supplier_code);
  const step = changeBillingStatus.bind(null, id);
  const firstDesc = items[0]?.description?.split(" / ")[0] ?? null;

  const text =
    docType === "settlement"
      ? requestText({
          supplierName: supplier?.name ?? d.supplier_code,
          company: d.recipient_company_name,
          representative: d.recipient_representative_name,
          businessNumber: formatBizNo(d.recipient_business_number) || null,
          emails: d.recipient_emails ?? [],
          periodStart: d.period_start,
          periodEnd: d.period_end,
          spend: Number(d.spend_amount),
          markupType: d.markup_type,
          markupRate: Number(d.markup_rate),
          markup: Number(d.markup_amount),
          minApplied: (items[0]?.description ?? "").includes("최소 대행비"),
          vatMode: d.vat_mode,
          adjustment: Number(d.adjustment_amount),
          adjustmentReason: d.adjustment_reason,
          total: Number(d.total_amount),
          hasRegistration: !!reg?.length,
          evidenceCount: files.length,
          staffName: d.staff?.name ?? "",
        })
      : "";

  return (
    <div className="space-y-4">
      <Link href="/billing" className="text-sm text-ink-soft hover:text-brand">← 정산·견적 목록</Link>
      <header className="glass flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h1 className="text-xl font-bold">{d.recipient_company_name} · {DOC_TYPE_LABEL[docType]}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            <span className="chip chip-info">{statusLabel(docType, status)}</span>
            <span className="ml-2">작성 {d.document_date}{d.period_start ? ` · 정산 ${d.period_start} ~ ${d.period_end}` : ""}</span>
            <span className="ml-2">담당 {d.staff?.name ?? "-"}</span>
            <span className="ml-2 font-semibold text-ink">{won(d.total_amount)}</span>
          </p>
          {status === "rejected" && <p className="mt-2 text-sm text-danger">반려 사유: {d.rejection_reason}</p>}
        </div>
        <Link href={`/print/billing/${id}`} target="_blank" className="btn btn-ghost">문서 보기 · 인쇄/PDF</Link>
      </header>

      <div className="grid gap-4 xl:grid-cols-[3fr_1fr]">
        <section className="glass p-5">
          <h2 className="mb-4 font-bold">{canEdit ? "내용 고치기" : "내용"}</h2>
          {!canEdit && <p className="mb-4 text-xs text-ink-soft">{["lead_approved", "approved", "issued"].includes(status) ? "승인이 진행된 문서는 금액을 고칠 수 없습니다. 고쳐야 하면 팀장·대표가 반려해 주세요." : "담당자나 팀장·대표만 고칠 수 있습니다."}</p>}
          <BillingForm
            action={saveBilling.bind(null, id)}
            clients={clients}
            contracts={contracts}
            suppliers={suppliers}
            isNew={false}
            readOnly={!canEdit}
            existingFiles={files.length}
            initial={{
              ...d,
              spend_amount: Number(d.spend_amount),
              markup_rate: Number(d.markup_rate),
              markup_fixed: Number(d.markup_fixed),
              min_fee: Number(d.min_fee),
              adjustment_amount: Number(d.adjustment_amount),
              item_description: docType === "settlement" ? firstDesc : null,
              items: items.map((i) => ({ item_name: i.item_name, description: i.description, unit_price: Number(i.unit_price), quantity: Number(i.quantity) })),
            }}
          />
        </section>

        <div className="space-y-4">
          <section className="glass space-y-2 p-5">
            <h2 className="font-bold">승인</h2>
            {(isOwner || isManager) && status === "draft" && <StepButton action={step} step="request" label="승인 요청" />}
            {(isOwner || isManager) && status === "requested" && <StepButton action={step} step="withdraw" label="요청 회수 (작성중으로)" ghost />}
            {docType === "settlement" && status === "requested" && isManager && (
              role === "ceo" ? <StepButton action={step} step="approve" label="최종 승인 (대표)" /> : <StepButton action={step} step="lead_approve" label="1차 승인 (팀장)" />
            )}
            {docType === "settlement" && status === "lead_approved" && (role === "ceo" ? <StepButton action={step} step="approve" label="최종 승인 (대표)" /> : <p className="text-sm text-ink-soft">대표 최종 승인 대기 중입니다.</p>)}
            {docType !== "settlement" && status === "requested" && isManager && <StepButton action={step} step="approve" label="확인 완료" />}
            {docType === "settlement" && status === "approved" && isManager && <StepButton action={step} step="issue" label="세금계산서 발행 완료 체크" />}
            {docType === "settlement" && status === "issued" && isManager && <StepButton action={step} step="unissue" label="발행 완료 취소" ghost />}
            {isManager && ["requested", "lead_approved", "approved"].includes(status) && <RejectForm action={step} />}
            {isManager && !["cancelled", "issued"].includes(status) && <StepButton action={step} step="cancel" label="문서 취소" ghost danger confirmText="이 문서를 취소할까요? (기록은 남습니다)" />}
            {docType === "settlement" && <CopyButton text={text} />}
          </section>

          {docType === "settlement" && ["approved", "issued"].includes(status) && (
            <section className="glass space-y-2 p-5">
              <h2 className="font-bold">입금</h2>
              <PaymentForm action={setBillingPayment.bind(null, id)} received={d.payment_received} paidAt={d.paid_at} readOnly={!(isManager || isOwner)} />
            </section>
          )}

          {docType === "settlement" && (
            <section className="glass p-5">
              <h2 className="mb-2 font-bold">증빙 파일</h2>
              <ul className="space-y-1 text-sm">
                {files.map((f: { id: string; file_name: string; storage_path: string }) => (
                  <li key={f.id} className="flex items-center justify-between gap-2">
                    {links[f.storage_path] ? <a href={links[f.storage_path]} target="_blank" rel="noreferrer" className="truncate text-brand underline">{f.file_name}</a> : <span className="truncate">{f.file_name}</span>}
                    {canEdit && <ConfirmSubmit action={removeBillingFile.bind(null, id, f.id)} label="삭제" confirmText="이 파일을 지울까요?" />}
                  </li>
                ))}
                {!files.length && <li className="text-[var(--warn-ink)]">아직 없습니다.</li>}
              </ul>
            </section>
          )}

          <section className="glass p-5">
            <h2 className="mb-2 font-bold">기록</h2>
            <ol className="space-y-1 text-xs">
              {logs.map((l) => (
                <li key={l.id}>
                  <span className="tabular-nums text-ink-soft">{new Date(l.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>{" "}
                  {l.actor?.name ?? "시스템"} · {STATUS_LABEL[l.to_status as BillingStatus] ?? l.to_status}
                  {l.reason && <span className="text-danger"> ({l.reason})</span>}
                </li>
              ))}
            </ol>
            {(d.lead?.name || d.ceo?.name || d.issuer?.name) && (
              <p className="mt-2 text-xs text-ink-soft">1차 {d.lead?.name ?? "-"} · 최종 {d.ceo?.name ?? "-"} · 발행 {d.issuer?.name ?? "-"}</p>
            )}
            {(isManager || (isOwner && ["draft", "rejected"].includes(status))) && (
              <div className="mt-3"><ConfirmSubmit action={deleteBilling.bind(null, id)} label="문서 삭제" confirmText="문서를 완전히 지울까요? 되돌릴 수 없습니다." /></div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
