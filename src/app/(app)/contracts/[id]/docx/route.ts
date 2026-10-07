import { getMe } from "@/lib/supabase/server";
import { FILE_BUCKET } from "@/lib/supabase/browser";
import { MEDIA_LABEL } from "@/lib/billing-data";
import { formatBizNo } from "@/lib/bizno";
import { CONTRACT_TEMPLATE_PATH, fillContractTemplate } from "@/lib/contract-docx";

// 계약서 Word 파일 내려받기: 계약 조건 + 거래처 정보를 양식에 채움
export async function GET(_: Request, ctx: RouteContext<"/contracts/[id]/docx">) {
  const { id } = await ctx.params;
  const { supabase, me } = await getMe();
  if (!me) return new Response("로그인이 필요합니다", { status: 401 });
  const { data: k } = await supabase
    .from("contracts")
    .select("contract_date,start_date,end_date,media,markup_type,markup_rate,vat_mode,auto_renew,client:clients(company_name,representative_name,business_number,address)")
    .eq("id", id)
    .maybeSingle();
  if (!k) return new Response("계약을 찾을 수 없습니다", { status: 404 });
  const c = k.client as unknown as { company_name: string; representative_name: string | null; business_number: string | null; address: string | null };
  const { data: tpl, error } = await supabase.storage.from(FILE_BUCKET).download(CONTRACT_TEMPLATE_PATH);
  if (error || !tpl) return new Response("계약서 양식을 불러오지 못했습니다", { status: 500 });
  const out = await fillContractTemplate(new Uint8Array(await tpl.arrayBuffer()), {
    contractDate: k.contract_date ?? "",
    clientName: c.company_name,
    clientRepresentative: c.representative_name ?? "",
    clientBusinessNumber: formatBizNo(c.business_number) || "",
    clientAddress: c.address ?? "",
    media: ((k.media ?? []) as string[]).map((m) => MEDIA_LABEL[m] ?? m).join(", "),
    markupRate: k.markup_type === "rate" ? String(Number(k.markup_rate)) : "0",
    vatIncluded: k.vat_mode === "included",
    start: k.start_date ?? "",
    end: k.end_date ?? "",
    autoRenew: !!k.auto_renew,
  });
  const name = `${c.company_name.replace(/[\\/:*?"<>|]/g, "_")}_광고대행계약서.docx`;
  return new Response(new Blob([out as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="contract.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
