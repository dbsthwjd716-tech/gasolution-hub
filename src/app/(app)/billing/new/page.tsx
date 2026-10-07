import Link from "next/link";
import { DOC_TYPE_LABEL, previousMonthRange, todayKST, type DocType } from "@/lib/billing-calc";
import { loadActiveContracts, loadBillingClients, loadSuppliers } from "@/lib/billing-data";
import { pickContract } from "@/lib/contract-pick";
import { getMe } from "@/lib/supabase/server";
import { saveBilling } from "../actions";
import { BillingForm } from "../forms";

export default async function NewBillingPage(props: PageProps<"/billing/new">) {
  const sp = await props.searchParams;
  const type = (typeof sp.type === "string" && sp.type in DOC_TYPE_LABEL ? sp.type : "settlement") as DocType;
  const clientId = typeof sp.client === "string" ? sp.client : undefined;
  const { supabase } = await getMe();
  const [clients, contracts, suppliers] = await Promise.all([loadBillingClients(supabase), loadActiveContracts(supabase), loadSuppliers(supabase)]);
  const today = todayKST();
  const k = clientId ? pickContract(contracts, clientId, today) : null;
  const prev = previousMonthRange(today);

  return (
    <div className="space-y-4">
      <Link href="/billing" className="text-sm text-ink-soft hover:text-brand">← 정산·견적 목록</Link>
      <div className="glass p-6">
        <h1 className="text-xl font-bold">{type === "settlement" ? "광고비 정산 · 세금계산서 발행요청" : DOC_TYPE_LABEL[type]} 작성</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">
          {type === "settlement"
            ? "거래처를 고르면 계약 완료된 조건(요율·최소 대행비·VAT)이 자동으로 들어갑니다. 승인 요청하면 팀장 1차 승인 → 대표 최종 승인 순서로 진행됩니다."
            : "단가는 VAT 포함 금액으로 적습니다. 승인 요청하면 팀장·대표 중 한 명이 확인합니다."}
        </p>
        <BillingForm
          action={saveBilling.bind(null, null)}
          clients={clients.filter((c) => c.status !== "ended" || c.id === clientId)}
          contracts={contracts}
          suppliers={suppliers}
          isNew
          initial={{
            doc_type: type,
            client_id: clientId,
            document_date: today,
            period_start: prev.start,
            period_end: prev.end,
            contract_id: k?.id ?? null,
            markup_type: k?.markup_type ?? "rate",
            markup_rate: k?.markup_rate ?? 0,
            markup_fixed: k?.markup_fixed ?? 0,
            min_fee: k?.min_fee ?? 0,
            vat_mode: k?.vat_mode ?? "included",
          }}
        />
      </div>
    </div>
  );
}
