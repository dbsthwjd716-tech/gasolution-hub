// 직원 서류 종류 (데이터베이스 staff_documents.kind 와 같음)
export const STAFF_DOC_BUCKET = "staff-docs";

export const DOC_KINDS = [
  { key: "contract", label: "근로계약서", when: "입사 후" },
  { key: "nda", label: "비밀유지서약서", when: "입사 후" },
  { key: "bankbook", label: "통장사본", when: "입사 후" },
  { key: "resident", label: "주민등록등본", when: "입사 후" },
  { key: "certificate", label: "자격증", when: "취득 시" },
  { key: "resignation", label: "퇴직사유서", when: "퇴사 시" },
  { key: "other", label: "기타", when: "" },
] as const;
export type DocKind = (typeof DOC_KINDS)[number]["key"];
export const DOC_LABEL = Object.fromEntries(DOC_KINDS.map((k) => [k.key, k.label])) as Record<DocKind, string>;
export const isDocKind = (v: string): v is DocKind => DOC_KINDS.some((k) => k.key === v);

// 꼭 받아야 하는 서류: 재직 중이면 입사 서류 4종, 퇴사했으면 퇴직사유서까지
export function missingDocs(kinds: string[], active: boolean): DocKind[] {
  const need: DocKind[] = active ? ["contract", "nda", "bankbook", "resident"] : ["contract", "nda", "bankbook", "resident", "resignation"];
  return need.filter((k) => !kinds.includes(k));
}
