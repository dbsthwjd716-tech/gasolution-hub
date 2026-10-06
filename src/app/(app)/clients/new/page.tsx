import Link from "next/link";
import { createClientRecord } from "../actions";
import { ClientForm } from "../forms";

export default function NewClientPage() {
  return (
    <div className="space-y-4">
      <Link href="/clients" className="text-sm text-ink-soft hover:text-brand">← 거래처 목록</Link>
      <div className="glass p-6">
        <h1 className="text-xl font-bold">거래처 등록</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">
          사업자번호를 넣으면 같은 사업자가 두 번 등록되지 않습니다. 등록한 사람이 담당자가 됩니다.
        </p>
        <ClientForm action={createClientRecord} submitLabel="등록" showBrand />
      </div>
    </div>
  );
}
