import Link from "next/link";
import { notFound } from "next/navigation";
import { getMe } from "@/lib/supabase/server";
import { updateViralOrder, updateViralStatus } from "../actions";
import { loadActiveStaff, loadClientOptions, loadPartners } from "../data";
import { ViralOrderForm, ViralStatusForm } from "../forms";

export default async function ViralDetail(props: PageProps<"/viral/[id]">) {
  const { id } = await props.params;
  const { supabase, me } = await getMe();
  const { data: o } = await supabase.from("viral_orders_view").select("*").eq("id", id).maybeSingle();
  if (!o) notFound();

  const [clients, partners, staff, { data: items }] = await Promise.all([
    loadClientOptions(supabase),
    loadPartners(supabase),
    loadActiveStaff(supabase),
    supabase
      .from("viral_order_items")
      .select("id,description,start_date,end_date,cost_amount,sale_amount,source_sheet,source_row")
      .eq("order_id", id)
      .order("sort_order")
      .order("created_at"),
  ]);
  // 퇴사 직원이 파생 실적자인 예전 건도 이름이 보이게
  if (o.derived_staff_id && !staff.some((x) => x.id === o.derived_staff_id))
    staff.push({ id: o.derived_staff_id, name: o.derived_staff_name ?? "(퇴사)" });
  // 종료된 거래처라도 이 건의 거래처는 보이게
  if (!clients.some((c) => c.id === o.client_id)) {
    clients.push({
      id: o.client_id,
      company_name: o.company_name,
      business_number: o.business_number,
      representative_name: o.representative_name,
      address: o.address,
      billing_emails: o.billing_emails ?? [],
      has_registration: o.has_registration,
      aliases: [],
      brands: o.brand_id ? [{ id: o.brand_id, name: o.brand_name }] : [],
    });
  }
  const canEdit = !!me && (me.role === "ceo" || me.role === "lead" || o.staff_id === me.id);

  return (
    <div className="space-y-4">
      <Link href="/viral" className="text-sm text-ink-soft hover:text-brand">← 바이럴 목록</Link>
      <header className="glass flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h1 className="text-xl font-bold">{o.company_name} · {o.partner_name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {o.paid_date ? `입금 ${o.paid_date}` : "입금 전"} · 담당 {o.staff_name ?? "미지정"}
            {o.derived_staff_name && <span className="ml-2 chip chip-info">파생 · {o.derived_staff_name}</span>}
            {o.source_sheet && (
              <span className="ml-2 chip chip-muted">
                시트 {o.source_sheet} {(items ?? []).map((i) => i.source_row).filter(Boolean).join("·")}행에서 옮김
              </span>
            )}
          </p>
        </div>
        {!canEdit && <span className="chip chip-muted">보기 전용 · 담당자나 팀장만 수정할 수 있습니다</span>}
      </header>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="glass p-5">
          <h2 className="mb-4 font-bold">건 정보</h2>
          <ViralOrderForm action={updateViralOrder.bind(null, id)} clients={clients} partners={partners} initial={{ ...o, items: items ?? [] }} staff={staff} canSetDerived={me?.role === "ceo" || me?.role === "lead"} submitLabel="저장" readOnly={!canEdit} />
        </section>
        <section className="glass h-fit p-5">
          <h2 className="mb-4 font-bold">진행 상태</h2>
          <ViralStatusForm action={updateViralStatus.bind(null, id)} initial={o} readOnly={!canEdit} />
        </section>
      </div>
    </div>
  );
}
