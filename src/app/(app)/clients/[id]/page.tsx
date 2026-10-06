import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBizNo } from "@/lib/bizno";
import { createClient } from "@/lib/supabase/server";
import { addAccount, addAlias, addBrand, addContact, updateClientRecord } from "../actions";
import { ClientForm, InlineForm } from "../forms";

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
  const supabase = await createClient();

  const [{ data: c }, { data: canEdit }] = await Promise.all([
    supabase
      .from("clients")
      .select(
        "*, owner:staff!clients_owner_staff_id_fkey(name), brands(id,name,is_active,media_accounts(id,platform,external_id,account_name,transferred_at,is_active,media_account_assignments(valid_to,staff(name)))), client_contacts(id,name,role_label,phone,email), name_aliases(id,alias,source)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.rpc("can_edit_client", { cid: id }),
  ]);
  if (!c) notFound();

  const brands = (c.brands ?? []) as { id: string; name: string; is_active: boolean; media_accounts: Account[] }[];
  const contacts = (c.client_contacts ?? []) as { id: string; name: string; role_label: string | null; phone: string | null; email: string | null }[];
  const aliases = (c.name_aliases ?? []) as { id: string; alias: string; source: string }[];

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
      </header>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="glass p-5">
          <h2 className="mb-4 font-bold">사업자 정보</h2>
          <ClientForm action={updateClientRecord.bind(null, id)} initial={c} submitLabel="저장" readOnly={!canEdit} />
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
