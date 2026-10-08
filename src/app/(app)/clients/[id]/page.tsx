import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBizNo } from "@/lib/bizno";
import { createClient } from "@/lib/supabase/server";
import { CONTRACT_STATUS, markupText, statusLabel, won } from "@/lib/billing-calc";
import { signedLinks } from "@/lib/storage";
import { addAccount, addAlias, addBrand, addClientDocument, addContact, deleteClientRecord, updateClientRecord } from "../actions";
import { ConfirmSubmit } from "../../billing/panel";
import { ClientForm, DocumentUploadForm, InlineForm } from "../forms";

const PLATFORM_LABEL: Record<string, string> = {
  naver_searchad: "네이버 검색광고",
  naver_gfa: "네이버 GFA",
  meta: "Meta",
  naver_place: "네이버 플레이스",
  kakao: "카카오",
  other: "기타",
};

type Account = {
  id: string;
  platform: string;
  external_id: string;
  account_name: string | null;
  transferred_at: string | null;
  is_active: boolean;
  media_account_assignments: { valid_to: string | null; staff: { name: string } | null }[];
};

export default async function ClientDetail(props: PageProps<"/clients/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const supabase = await createClient();

  const [{ data: c }, { data: canEdit }, { data: isManager }, { data: staff }] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "*, owner:staff!clients_owner_staff_id_fkey(name), brands(id,name,is_active,media_accounts(id,platform,external_id,account_name,transferred_at,is_active,media_account_assignments(valid_to,staff(name)))), client_contacts(id,name,role_label,phone,email), name_aliases(id,alias,source), client_documents(id,document_type,file_name,storage_path,created_at), contracts(id,status,markup_type,markup_rate,markup_fixed,start_date,end_date), billing_documents(id,doc_type,status,document_date,total_amount)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.rpc("can_edit_client", { cid: id }),
    supabase.rpc("is_manager"),
    supabase.from("staff").select("id,name").eq("is_active", true).order("name"),
  ]);
  if (!c) notFound();

  const brands = (c.brands ?? []) as { id: string; name: string; is_active: boolean; media_accounts: Account[] }[];
  const contacts = (c.client_contacts ?? []) as { id: string; name: string; role_label: string | null; phone: string | null; email: string | null }[];
  const aliases = (c.name_aliases ?? []) as { id: string; alias: string; source: string }[];
  const docs = (c.client_documents ?? []) as { id: string; document_type: string; file_name: string; storage_path: string }[];
  const contracts = (c.contracts ?? []) as { id: string; status: string; markup_type: "rate" | "fixed" | "none"; markup_rate: number; markup_fixed: number; start_date: string | null; end_date: string | null }[];
  const bills = ((c.billing_documents ?? []) as { id: string; doc_type: "settlement"; status: "draft"; document_date: string; total_amount: number }[])
    .sort((a, b) => b.document_date.localeCompare(a.document_date))
    .slice(0, 8);
  const links = await signedLinks(supabase, docs.map((d) => d.storage_path));
  const DOC_LABEL: Record<string, string> = { business_registration: "사업자등록증", bank_account: "통장 사본", other: "기타" };

  return (
    <div className="space-y-4">
      <Link href="/clients" className="text-sm text-ink-soft hover:text-brand">← 거래처 목록</Link>

      <header className="glass flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h1 className="text-2xl font-bold">{c.company_name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {c.is_provisional ? (
              <span className="chip chip-warn">사업자번호 없음 · 임시 거래처</span>
            ) : (
              <span className="tabular-nums">사업자번호 {formatBizNo(c.business_number)}</span>
            )}
            <span className="ml-3">담당 {c.owner?.name ?? "-"}</span>
          </p>
        </div>
        {!canEdit && <span className="chip chip-muted">보기 전용 · 담당자나 팀장만 수정할 수 있습니다</span>}
        {isManager && <ConfirmSubmit action={deleteClientRecord.bind(null, id)} label="거래처 삭제" confirmText={`${c.company_name} 거래처를 삭제할까요? 되돌릴 수 없습니다.`} />}
      </header>
      {typeof sp.error === "string" && <p className="glass p-3 text-sm text-danger">{sp.error}</p>}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="glass p-5">
          <h2 className="mb-4 font-bold">사업자 정보</h2>
          <ClientForm action={updateClientRecord.bind(null, id)} initial={c} submitLabel="저장" readOnly={!canEdit} staff={isManager ? (staff ?? []) : []} />
        </section>

        <div className="space-y-4">
          <section className="glass p-5">
            <h2 className="font-bold">브랜드와 매체 계정</h2>
            <p className="mb-4 text-xs text-ink-soft">브랜드(광고주) 밑에 실제 광고 계정이 붙습니다.</p>
            <ul className="space-y-4">
              {brands.map((b) => (
                <li key={b.id} className="rounded-xl border border-[var(--glass-border)] bg-white/60 p-3">
                  <p className="font-semibold">{b.name}</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {b.media_accounts.map((a) => {
                      const current = a.media_account_assignments.find((x) => !x.valid_to);
                      return (
                        <li key={a.id} className="flex flex-wrap items-center gap-2">
                          <span className="chip chip-info">{PLATFORM_LABEL[a.platform] ?? a.platform}</span>
                          <span className="tabular-nums">{a.external_id}</span>
                          {a.account_name && <span className="text-ink-soft">{a.account_name}</span>}
                          {a.transferred_at && <span className="chip chip-muted">이관 {a.transferred_at}</span>}
                          <span className="ml-auto text-xs text-ink-soft">{current?.staff?.name ?? "담당 미지정"}</span>
                        </li>
                      );
                    })}
                    {!b.media_accounts.length && <li className="text-xs text-ink-soft">연결된 계정 없음</li>}
                  </ul>
                </li>
              ))}
              {!brands.length && <li className="text-sm text-ink-soft">브랜드가 없습니다.</li>}
            </ul>
            {canEdit && (
              <div className="mt-5 space-y-4 border-t border-[var(--glass-border)] pt-4">
                <InlineForm action={addBrand.bind(null, id)} submitLabel="브랜드 추가">
                  <input name="name" placeholder="브랜드명" className="field" aria-label="브랜드명" />
                </InlineForm>
                {brands.length > 0 && (
                  <InlineForm action={addAccount.bind(null, id)} submitLabel="계정 연결">
                    <select name="brand_id" className="field" aria-label="브랜드">
                      {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <select name="platform" className="field" aria-label="매체">
                      {Object.entries(PLATFORM_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <input name="external_id" placeholder="계정 번호" className="field" aria-label="계정 번호" />
                  </InlineForm>
                )}
              </div>
            )}
          </section>

          <section className="glass p-5">
            <h2 className="mb-3 font-bold">서류</h2>
            <ul className="space-y-1 text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <span className="chip chip-muted">{DOC_LABEL[d.document_type] ?? d.document_type}</span>
                  {links[d.storage_path] ? <a href={links[d.storage_path]} target="_blank" rel="noreferrer" className="truncate text-brand underline">{d.file_name}</a> : <span className="truncate">{d.file_name}</span>}
                </li>
              ))}
              {!docs.some((d) => d.document_type === "business_registration") && <li className="text-[var(--warn-ink)]">사업자등록증이 없습니다. 세금계산서 발행 전에 올려 주세요.</li>}
            </ul>
            {canEdit && <div className="mt-4 border-t border-[var(--glass-border)] pt-4"><DocumentUploadForm action={addClientDocument.bind(null, id)} /></div>}
          </section>

          <section className="glass p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">계약 · 정산</h2>
              <div className="flex gap-3 text-sm">
                <Link href={`/contracts/new?client=${id}`} className="text-brand underline">계약 등록</Link>
                <Link href={`/billing/new?type=settlement&client=${id}`} className="text-brand underline">정산서</Link>
                <Link href={`/billing/new?type=viral_estimate&client=${id}`} className="text-brand underline">견적서</Link>
              </div>
            </div>
            <ul className="space-y-1 text-sm">
              {contracts.map((k) => (
                <li key={k.id} className="flex items-center gap-2">
                  <span className={`chip ${CONTRACT_STATUS[k.status]?.cls}`}>{CONTRACT_STATUS[k.status]?.label}</span>
                  <Link href={`/contracts/${k.id}`} className="hover:text-brand">계약 {markupText(k.markup_type, k.markup_rate, k.markup_fixed)} · {k.start_date ?? "?"} ~ {k.end_date ?? ""}</Link>
                </li>
              ))}
              {bills.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <Link href={`/billing/${b.id}`} className="hover:text-brand">{b.document_date} · {statusLabel(b.doc_type, b.status)}</Link>
                  <span className="tabular-nums">{won(b.total_amount)}</span>
                </li>
              ))}
              {!contracts.length && !bills.length && <li className="text-ink-soft">아직 없습니다.</li>}
            </ul>
          </section>

          <section className="glass p-5">
            <h2 className="mb-3 font-bold">업체 담당자</h2>
            <ul className="space-y-2 text-sm">
              {contacts.map((p) => (
                <li key={p.id}>
                  <span className="font-semibold">{p.name}</span>
                  {p.role_label && <span className="text-ink-soft"> · {p.role_label}</span>}
                  <div className="text-xs text-ink-soft">{[p.phone, p.email].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
              {!contacts.length && <li className="text-ink-soft">등록된 담당자가 없습니다.</li>}
            </ul>
            {canEdit && (
              <div className="mt-4 border-t border-[var(--glass-border)] pt-4">
                <InlineForm action={addContact.bind(null, id)}>
                  <input name="name" placeholder="이름" className="field" aria-label="이름" />
                  <input name="role_label" placeholder="역할(실무자 등)" className="field" aria-label="역할" />
                  <input name="phone" placeholder="전화" className="field" aria-label="전화" />
                </InlineForm>
              </div>
            )}
          </section>

          <section className="glass p-5">
            <h2 className="font-bold">다른 이름</h2>
            <p className="mb-3 text-xs text-ink-soft">시트·CRM에서 다르게 적던 이름을 모아 두면, 같은 이름이 들어올 때 이 거래처로 자동 연결됩니다.</p>
            <div className="flex flex-wrap gap-1">
              {aliases.map((a) => <span key={a.id} className="chip chip-muted">{a.alias}</span>)}
              {!aliases.length && <span className="text-sm text-ink-soft">없음</span>}
            </div>
            {canEdit && (
              <div className="mt-4 border-t border-[var(--glass-border)] pt-4">
                <InlineForm action={addAlias.bind(null, id)}>
                  <input name="alias" placeholder="예: 삼삼뮬류" className="field" aria-label="다른 이름" />
                </InlineForm>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
