import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { createViralOrder } from "../actions";
import { loadActiveStaff, loadClientOptions, loadPartners, loadPrices } from "../data";
import { ViralOrderForm } from "../forms";

export default async function NewViralPage() {
  const { supabase, me } = await getMe();
  const [clients, partners, staff, prices] = await Promise.all([loadClientOptions(supabase), loadPartners(supabase), loadActiveStaff(supabase), loadPrices(supabase)]);
  const isManager = me?.role === "ceo" || me?.role === "lead";
  return (
    <div className="space-y-4">
      <Link href="/viral" className="text-sm text-ink-soft hover:text-brand">← 바이럴 목록</Link>
      <div className="glass max-w-4xl p-6">
        <h1 className="text-xl font-bold">바이럴 건 입력</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">거래처를 고르면 대표자·사업자번호·주소·메일을 다시 적지 않아도 됩니다. 한 번에 입금된 상품(슬롯)은 한 건 안에 여러 줄로 넣으세요. 입력한 사람이 담당자가 됩니다.</p>
        <ViralOrderForm action={createViralOrder} clients={clients} partners={partners} staff={staff} canSetDerived={isManager} prices={prices} submitLabel="저장" />
      </div>
    </div>
  );
}
