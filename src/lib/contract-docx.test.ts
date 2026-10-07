import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { fillContractTemplate, type ContractVars } from "./contract-docx.ts";

const base: ContractVars = {
  contractDate: "2026-10-07", clientName: "용접공구 & 상사", clientRepresentative: "이병석", clientBusinessNumber: "122-01-55229",
  clientAddress: "서울", media: "네이버, 메타", markupRate: "14.3", vatIncluded: true, start: "2026-10-01", end: "", autoRenew: true,
};

async function make(xml: string) {
  const z = new JSZip();
  z.file("word/document.xml", xml);
  z.file("[Content_Types].xml", "<Types/>");
  return z.generateAsync({ type: "uint8array" });
}
const read = async (b: Uint8Array) => (await JSZip.loadAsync(b)).file("word/document.xml")!.async("string");

test("자리표시를 채우고 특수문자는 Word용으로 바꿈", async () => {
  const out = await read(await fillContractTemplate(await make("<w:t>{{CLIENT_NAME}} / {{MARKUP_RATE}}% {{VAT_TYPE}} / {{MEDIA_LIST}} / 앰엔에이치</w:t>"), base));
  assert.equal(out, "<w:t>용접공구 &amp; 상사 / 14.3% VAT포함 / 네이버, 메타 / 용접공구 &amp; 상사</w:t>");
});

test("끝나는 날이 없으면 '~부터'로 정리, 자동 연장 문구", async () => {
  const out = await read(await fillContractTemplate(await make("<w:t>계약기간은 {{CONTRACT_START}}부터 {{CONTRACT_END}}까지로 정한다. {{AUTO_RENEW_CLAUSE}}</w:t>"), base));
  assert.match(out, /2026-10-01부터로 정한다\./);
  assert.match(out, /1개월씩 자동 연장된다/);
  const withEnd = await read(await fillContractTemplate(await make("<w:t>{{CONTRACT_PERIOD}}</w:t>"), { ...base, end: "2027-09-30", autoRenew: false }));
  assert.equal(withEnd, "<w:t>2026-10-01부터 2027-09-30까지</w:t>");
});
