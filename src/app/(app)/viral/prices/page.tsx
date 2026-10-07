import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { PRODUCT_TYPES } from "@/lib/viral-products";
import { ConfirmSubmit } from "../../billing/panel";
import { deletePrice, savePrice } from "../actions";
import { loadPartners, loadPrices } from "../data";
import { PriceForm } from "../forms";

const won = (n: number) => Number(n).toLocaleString("ko-KR");

export default async function ViralPrices() {
  const { supabase, me } = await getMe();
  const isManager = me?.role === "ceo" || me?.role === "lead";
  const [partners, prices] = await Promise.all([loadPartners(supabase), loadPrices(supabase)]);
  const order = (t: string) => PRODUCT_TYPES.indexOf(t as (typeof PRODUCT_TYPES)[number]);

  return (
    <div className="space-y-4">
      <Link href="/viral" className="text-sm text-ink-soft hover:text-brand">← 바이럴 목록</Link>
      <header>
        <h1 className="text-2xl font-bold">협력사 단가표</h1>
        <p className="text-sm text-ink-soft">
          1개(슬롯·건)당 공급가(VAT 포함)와 판매가(VAT 별도). 바이럴 입력에서 협력사·상품·일수·수량을 고르면 이 표로 금액이 자동으로 들어갑니다.
          매체·상품명·일수를 비워 두면 그 협력사·상품 종류의 공통 단가로 쓰입니다.
        </p>
      </header>
      {isManager && (
        <section className="glass p-4">
          <h2 className="mb-2 text-sm font-bold">단가 추가</h2>
          <PriceForm action={savePrice.bind(null, null)} partners={partners} submitLabel="추가" />
        </section>
      )}
      {partners.map((p) => {
        const rows = prices
          .filter((x) => x.partner_id === p.id)
          .sort((a, b) => order(a.product_type) - order(b.product_type) || (a.product_name ?? "").localeCompare(b.product_name ?? "") || (a.days ?? 0) - (b.days ?? 0));
        return (
          <section key={p.id} className="glass p-4">
            <h2 className="mb-2 font-bold">{p.name} <span className="text-xs font-normal text-ink-soft">{rows.length}개</span></h2>
            {isManager ? (
              <div className="space-y-2">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-start gap-2">
                    <div className="flex-1"><PriceForm action={savePrice.bind(null, r.id)} partners={partners} initial={r} submitLabel="저장" /></div>
                    <div className="pt-3"><ConfirmSubmit action={deletePrice.bind(null, r.id)} label="삭제" confirmText="이 단가를 지울까요?" /></div>
                  </div>
                ))}
                {!rows.length && <p className="text-sm text-ink-soft">아직 단가가 없습니다.</p>}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-soft"><tr><th className="py-1">상품</th><th>매체</th><th>상품명</th><th className="text-right">일수</th><th className="text-right">공급가(VAT포함)</th><th className="text-right">판매가(VAT별도)</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--glass-border)]">
                      <td className="py-1">{r.product_type}</td><td>{r.platform ?? "공통"}</td><td>{r.product_name ?? "공통"}</td>
                      <td className="text-right">{r.days ? `${r.days}일` : "-"}</td>
                      <td className="text-right tabular-nums">{r.cost_price == null ? "-" : `${won(r.cost_price)}/${r.unit_label}`}</td>
                      <td className="text-right tabular-nums">{won(r.sale_price)}/{r.unit_label}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={6} className="py-2 text-ink-soft">아직 단가가 없습니다.</td></tr>}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
