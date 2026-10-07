import Link from "next/link";
import { todayKST } from "@/lib/billing-calc";
import { loadBillingClients, loadStaffNames } from "@/lib/billing-data";
import { getMe } from "@/lib/supabase/server";
import { createContract } from "../actions";
import { ContractForm } from "../forms";

export default async function NewContractPage(props: PageProps<"/contracts/new">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  const [clients, staff] = await Promise.all([loadBillingClients(supabase), loadStaffNames(supabase)]);
  const clientId = typeof sp.client === "string" ? sp.client : undefined;
  return (
    <div className="space-y-4">
      <Link href="/contracts" className="text-sm text-ink-soft hover:text-brand">← 계약 목록</Link>
      <div className="glass max-w-4xl p-6">
        <h1 className="text-xl font-bold">계약 등록</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">등록 후 서명본을 올리거나 &lsquo;계약서 없이 완료&rsquo;로 대표·팀장이 완료 처리하면, 그 조건이 정산서에 자동으로 들어갑니다.</p>
        <ContractForm
          action={createContract}
          clients={clients.filter((c) => c.status !== "ended")}
          staff={staff.filter((x) => x.is_active)}
          canPickStaff={me?.role !== "staff"}
          initial={{ client_id: clientId, contract_date: todayKST(), markup_type: "rate", vat_mode: "included" }}
          submitLabel="등록"
        />
      </div>
    </div>
  );
}
