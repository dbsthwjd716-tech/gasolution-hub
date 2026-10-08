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

// 회사 이름 표기 통일: "주식회사 ㈜지에이솔루션"처럼 겹친 표기와 모든 "주식회사"·"㈜"를 "(주)"로
// Word는 한 문장을 여러 조각(<w:t>)으로 나눠 저장하므로, 문단 안의 글자를 이어 붙여 찾은 뒤 조각별로 고쳐 넣음
const COMPANY_RULES: [RegExp, string][] = [
  [/주식회사\s*(?:㈜|\(주\))\s*/g, "(주)"],
  [/(?:㈜|\(주\))\s*주식회사\s*/g, "(주)"],
  [/주식회사\s*/g, "(주)"],
  [/㈜/g, "(주)"],
];

const unescXml = (v: string) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function normalizeCompanyText(text: string): string {
  let t = text;
  for (const [re, to] of COMPANY_RULES) t = t.replace(re, to);
  return t;
}

// 문단마다 <w:t> 조각을 이어 붙여 규칙을 적용하고, 바뀐 글자를 원래 조각 경계에 맞춰 다시 나눠 넣음
export function normalizeCompanyNames(xml: string): string {
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    const parts: { full: string; open: string; text: string }[] = [];
    const re = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)<\/w:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(para))) parts.push({ full: m[0], open: m[1], text: unescXml(m[2]) });
    if (!parts.length) return para;
    const joined = parts.map((x) => x.text).join("");
    if (!/주식회사|㈜/.test(joined)) return para;
    // 글자 하나하나가 어느 조각에서 왔는지 기억하며 규칙 적용
    const owner: number[] = [];
    parts.forEach((x, i) => { for (let k = 0; k < x.text.length; k++) owner.push(i); });
    let chars = joined.split("").map((c, k) => ({ c, o: owner[k] }));
    for (const [rule, to] of COMPANY_RULES) {
      const text = chars.map((x) => x.c).join("");
      const out: typeof chars = [];
      let last = 0;
      for (const mm of text.matchAll(new RegExp(rule.source, "g"))) {
        const at = mm.index ?? 0;
        out.push(...chars.slice(last, at));
        const o = chars[at].o; // 바뀐 글자는 찾은 부분이 시작된 조각에 넣음
        for (const c of to) out.push({ c, o });
        last = at + mm[0].length;
      }
      out.push(...chars.slice(last));
      chars = out;
    }
    const texts = parts.map(() => "");
    for (const x of chars) texts[x.o] += x.c;
    let i = 0;
    return para.replace(re, (_all, open: string) => {
      const t = texts[i++];
      const o = /xml:space=/.test(open) ? open : open.replace("<w:t", '<w:t xml:space="preserve"');
      return `${o}${escXml(t)}</w:t>`;
    });
  });
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
    xml = normalizeCompanyNames(xml);
    zip.file(n, xml);
  }
  return zip.generateAsync({ type: "uint8array" });
}
