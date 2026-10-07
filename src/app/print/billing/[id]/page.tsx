import { notFound, redirect } from "next/navigation";
import { formatBizNo } from "@/lib/bizno";
import { markupText, won, type DocType } from "@/lib/billing-calc";
import { getMe } from "@/lib/supabase/server";
import { PrintButton } from "./print-button";

export const metadata = { title: "문서 인쇄" };

const TITLE: Record<DocType, string> = {
  settlement: "광고비 정산서",
  viral_estimate: "바이럴 견적서",
  detailed_estimate: "견 적 서",
  simple_estimate: "견 적 서",
};

const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일` : "");
const n = (v: unknown) => Number(v) || 0;

export default async function PrintBilling(props: PageProps<"/print/billing/[id]">) {
  const { id } = await props.params;
  const { supabase, user, me } = await getMe();
  if (!user) redirect("/login");
  if (!me) notFound();
  const { data: d } = await supabase
    .from("billing_documents")
    .select("*, staff:staff!billing_documents_staff_id_fkey(name), supplier:suppliers(*), billing_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (!d) notFound();
  const s = d.supplier;
  const docType = d.doc_type as DocType;
  const isSettlement = docType === "settlement";
  const items = [...(d.billing_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const th = "border border-[#9fb3d1] bg-[#233f6d] px-2 py-1.5 text-center font-semibold text-white";
  const tdL = "border border-[#c9d5e6] bg-[#eef3fa] px-2 py-1.5 font-semibold w-28";
  const td = "border border-[#c9d5e6] px-2 py-1.5";

  return (
    <div className="min-h-screen bg-[#e9edf3] py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4 portrait; margin: 10mm; } @media print { .no-print { display: none !important; } body { background: white !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-2">
        <p className="text-sm text-ink-soft">인쇄 창에서 &lsquo;PDF로 저장&rsquo;을 고르면 PDF 파일이 됩니다.</p>
        <PrintButton />
      </div>
      <article className="mx-auto w-full max-w-[190mm] bg-white p-[10mm] text-[12px] leading-relaxed text-[#142140] shadow print:max-w-none print:p-0 print:shadow-none">
        <div className="flex items-end justify-between border-b-2 border-[#233f6d] pb-3">
          <h1 className="text-[26px] font-bold tracking-[0.3em]">{TITLE[docType]}</h1>
          <p className="text-right text-sm font-bold text-[#233f6d]">{s?.name}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <table className="w-full border-collapse">
            <tbody>
              <tr><td className={tdL}>일 자</td><td className={td}>{d.document_date}</td></tr>
              {isSettlement && d.period_start && <tr><td className={tdL}>정산 기간</td><td className={td}>{md(d.period_start)} ~ {md(d.period_end)}</td></tr>}
              <tr><td className={tdL}>수 신</td><td className={td}>{d.recipient_company_name} 귀하</td></tr>
              <tr><td className={tdL}>사업자번호</td><td className={td}>{formatBizNo(d.recipient_business_number) || "-"}</td></tr>
              <tr><td className={tdL}>대 표 자</td><td className={td}>{d.recipient_representative_name ?? "-"}</td></tr>
              {isSettlement && <tr><td className={tdL}>이 메 일</td><td className={td}>{(d.recipient_emails ?? []).join(" / ") || "-"}</td></tr>}
            </tbody>
          </table>
          <table className="w-full border-collapse">
            <tbody>
              <tr><td className={th} colSpan={2}>공 급 자</td></tr>
              <tr><td className={tdL}>상 호</td><td className={td}>{s?.name}</td></tr>
              <tr><td className={tdL}>대 표 자</td><td className={td}>{s?.representative_name ?? "-"}</td></tr>
              <tr><td className={tdL}>사업자번호</td><td className={td}>{s?.business_number ?? "-"}</td></tr>
              <tr><td className={tdL}>주 소</td><td className={td}>{s?.address ?? "-"}</td></tr>
              {(s?.phone || s?.email) && <tr><td className={tdL}>연 락 처</td><td className={td}>{[s?.phone, s?.email].filter(Boolean).join(" / ")}</td></tr>}
              <tr><td className={tdL}>담 당 자</td><td className={td}>{d.staff?.name ?? "-"}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between rounded border border-[#9fb3d1] bg-[#dce8f3] px-4 py-3">
          <span className="font-bold">{isSettlement ? "세금계산서 발행 요청금액" : "합계금액 (VAT 포함)"}</span>
          <span className="text-[18px] font-bold tabular-nums">{won(d.total_amount)}</span>
        </div>

        {isSettlement && (
          <p className="mt-3 rounded border border-[#c9d5e6] bg-[#f6f9fd] px-3 py-2">
            정산 기준: 광고비 소진액 {won(d.spend_amount)} · 마크업 {markupText(d.markup_type, n(d.markup_rate), n(d.markup_fixed))}
            {n(d.min_fee) > 0 && ` · 최소 대행비 ${won(d.min_fee)}`} → 마크업 비용 {won(d.markup_amount)} (VAT {d.vat_mode === "included" ? "포함" : "별도"})
          </p>
        )}

        <table className="mt-4 w-full border-collapse tabular-nums">
          <thead>
            <tr>
              <th className={th}>No</th>
              <th className={th}>품명</th>
              <th className={th}>내용</th>
              {!isSettlement && <th className={th}>단가</th>}
              {!isSettlement && <th className={th}>수량</th>}
              <th className={th}>공급가액</th>
              <th className={th}>세액</th>
              <th className={th}>합계</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id}>
                <td className={`${td} text-center`}>{i + 1}</td>
                <td className={td}>{it.item_name}</td>
                <td className={td}>{it.description ?? ""}</td>
                {!isSettlement && <td className={`${td} text-right`}>{n(it.unit_price).toLocaleString("ko-KR")}</td>}
                {!isSettlement && <td className={`${td} text-right`}>{n(it.quantity)}</td>}
                <td className={`${td} text-right`}>{n(it.supply_amount).toLocaleString("ko-KR")}</td>
                <td className={`${td} text-right`}>{n(it.vat_amount).toLocaleString("ko-KR")}</td>
                <td className={`${td} text-right`}>{n(it.total_amount).toLocaleString("ko-KR")}</td>
              </tr>
            ))}
            {n(d.adjustment_amount) !== 0 && (
              <tr>
                <td className={`${td} text-center`}>-</td>
                <td className={td}>{n(d.adjustment_amount) > 0 ? "추가" : "차감"}</td>
                <td className={td}>{d.adjustment_reason}</td>
                {!isSettlement && <td className={td} />}
                {!isSettlement && <td className={td} />}
                <td className={td} />
                <td className={td} />
                <td className={`${td} text-right`}>{n(d.adjustment_amount).toLocaleString("ko-KR")}</td>
              </tr>
            )}
            <tr className="font-bold">
              <td className={`${td} bg-[#dce8f3] text-center`} colSpan={isSettlement ? 3 : 5}>합 계</td>
              <td className={`${td} bg-[#dce8f3] text-right`}>{n(d.supply_amount).toLocaleString("ko-KR")}</td>
              <td className={`${td} bg-[#dce8f3] text-right`}>{n(d.vat_amount).toLocaleString("ko-KR")}</td>
              <td className={`${td} bg-[#dce8f3] text-right`}>{n(d.total_amount).toLocaleString("ko-KR")}</td>
            </tr>
          </tbody>
        </table>

        <table className="mt-4 w-full border-collapse">
          <tbody>
            <tr><td className={th} colSpan={2}>비 고</td></tr>
            {s?.bank_account && <tr><td className={tdL}>입금 계좌</td><td className={td}>{s.bank_account} (예금주 {s.bank_holder})</td></tr>}
            <tr><td className={tdL}>VAT</td><td className={td}>{isSettlement ? (d.vat_mode === "included" ? "마크업 금액에 포함" : "마크업 금액의 10% 별도") : "표기된 단가는 VAT 포함 금액입니다."}</td></tr>
            {d.note && <tr><td className={tdL}>메 모</td><td className={`${td} whitespace-pre-wrap`}>{d.note}</td></tr>}
          </tbody>
        </table>
      </article>
    </div>
  );
}
