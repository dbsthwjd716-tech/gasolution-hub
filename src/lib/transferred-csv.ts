// 네이버 유상실적 CSV 읽기 (예전 대시보드 '피이관 실적 업로드'와 같은 규칙)
//   필수 열: 날짜, 광고계정 CustomerID, 광고주명, 유상실적TOTAL
//   날짜는 2026-10-01 / 2026.10.1 / 2026/10/01 / 20261001 모두 받음, 금액의 쉼표·원·공백은 무시

export type TransferredRow = { c: string; d: string; v: number; n: string };
export type ParsedCsv = { rows: TransferredRow[]; start: string | null; end: string | null; skipped: number; customers: number; total: number };

export function parseCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export function normalizeDate(v: string) {
  const t = v.replace(/"/g, "").trim();
  let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/);
  if (!m) m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const s = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s;
}

export const parseMoney = (v: string) => {
  const n = Number(String(v ?? "").replace(/[,원\s"]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export const REQUIRED = ["날짜", "광고계정 CustomerID", "광고주명", "유상실적TOTAL"] as const;

export function parseTransferredCsv(text: string): ParsedCsv | { error: string } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { error: "CSV에 데이터가 없습니다." };
  const head = parseCsvLine(lines[0]).map((h) => h.replace(/^﻿/, "").trim());
  const idx = REQUIRED.map((h) => head.indexOf(h));
  const missing = REQUIRED.filter((_, i) => idx[i] < 0);
  if (missing.length) return { error: `필수 열을 찾을 수 없습니다: ${missing.join(", ")} — 네이버 유상실적 CSV가 맞는지 확인해 주세요.` };
  const [di, ci, ni, vi] = idx;
  const rows: TransferredRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const v = parseCsvLine(line);
    const d = normalizeDate(v[di] ?? "");
    const c = String(v[ci] ?? "").replace(/"/g, "").trim();
    if (!d || !/^\d+$/.test(c)) { skipped++; continue; }
    rows.push({ c, d, v: parseMoney(v[vi] ?? ""), n: (v[ni] ?? "").trim() });
  }
  if (!rows.length) return { error: "읽을 수 있는 실적 줄이 없습니다." };
  const dates = rows.map((r) => r.d).sort();
  return {
    rows,
    start: dates[0],
    end: dates[dates.length - 1],
    skipped,
    customers: new Set(rows.map((r) => r.c)).size,
    total: rows.reduce((t, r) => t + r.v, 0),
  };
}
