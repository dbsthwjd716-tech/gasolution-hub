import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createViralOrder } from "../actions";
import { loadClientOptions, loadPartners } from "../data";
import { ViralOrderForm } from "../forms";

export default async function NewViralPage() {
  const supabase = await createClient();
  const [clients, partners] = await Promise.all([loadClientOptions(supabase), loadPartners(supabase)]);
  return (
    <div className="space-y-4">
      <Link href="/viral" className="text-sm text-ink-soft hover:text-brand">← 바이럴 목록</Link>
      <div className="glass max-w-3xl p-6">
        <h1 className="text-xl font-bold">바이럴 건 입력</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">거래처를 고르면 대표자·사업자번호·주소·메일을 다시 적지 않아도 됩니다. 입력한 사람이 담당자가 됩니다.</p>
        <ViralOrderForm action={createViralOrder} clients={clients} partners={partners} submitLabel="저장" />
      </div>
    </div>
  );
}
