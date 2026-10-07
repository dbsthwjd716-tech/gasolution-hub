import JSZip from "jszip";

// 광고대행 계약서 Word 양식에 계약 정보를 채움 (예전 정산·계약 시스템과 같은 자리표시: {{CLIENT_NAME}} 등)
export const CONTRACT_TEMPLATE_PATH = "legacy-billing/templates/GA_Solution_Contract_Master_Template.docx";

export type ContractVars = {
  contractDate: string;
  clientName: string;
  clientRepresentative: string;
  clientBusinessNumber: string;
  clientAddress: string;
  media: string;
  markupRate: string;
  vatIncluded: boolean;
  start: string;
  end: string;
  autoRenew: boolean;
};

const AUTO_RENEW = "계약 만료 1개월 전까지 서면으로 갱신 거절 또는 계약 내용 변경의 의사표시가 없는 경우 본 계약은 동일한 조건으로 1개월씩 자동 연장된다.";
const NO_RENEW = "본 계약은 계약기간 만료일에 종료되며 자동 연장하지 않는다.";

const escXml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function contractReplacements(v: ContractVars): Record<string, string> {
  return {
    "{{CONTRACT_DATE}}": v.contractDate,
    "{{CLIENT_NAME}}": v.clientName,
    "{{CLIENT_REPRESENTATIVE}}": v.clientRepresentative,
    "{{CLIENT_BUSINESS_NUMBER}}": v.clientBusinessNumber,
    "{{CLIENT_ADDRESS}}": v.clientAddress,
    "{{MEDIA_LIST}}": v.media || "-",
    "{{MARKUP_RATE}}": v.markupRate,
    "{{VAT_TYPE}}": v.vatIncluded ? "VAT포함" : "VAT별도",
    "{{CONTRACT_START}}": v.start,
    "{{CONTRACT_END}}": v.end,
    "{{CONTRACT_PERIOD}}": v.end ? `${v.start}부터 ${v.end}까지` : `${v.start}부터`,
    "{{AUTO_RENEW_CLAUSE}}": v.autoRenew ? AUTO_RENEW : NO_RENEW,
  };
}

// 양식 안의 글자를 바꾼 새 Word 파일. 끝나는 날이 없으면 "~부터 까지로 정한다" 같은 문장을 정리
export async function fillContractTemplate(template: ArrayBuffer | Uint8Array, v: ContractVars): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const reps = contractReplacements(v);
  const names = Object.keys(zip.files).filter((n) => n.startsWith("word/") && n.endsWith(".xml"));
  for (const n of names) {
    let xml = await zip.file(n)!.async("string");
    for (const [k, val] of Object.entries(reps)) xml = xml.split(k).join(escXml(val));
    // 예전 양식에 남아 있던 견본 업체명
    xml = xml.split("앰엔에이치").join(escXml(v.clientName));
    if (!v.end) xml = xml.replace(/부터\s*까지로 정한다\./g, "부터로 정한다.").replace(/부터\s*까지/g, "부터");
    zip.file(n, xml);
  }
  return zip.generateAsync({ type: "uint8array" });
}
