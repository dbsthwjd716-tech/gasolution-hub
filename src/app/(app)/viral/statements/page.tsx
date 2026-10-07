import Link from "next/link";
import { canViewCost, getMe } from "@/lib/supabase/server";
import { signedLinks } from "@/lib/storage";
import { loadPartners } from "../data";
import { createStatement, setStatementFlag } from "./actions";
import { StatementForm } from "./forms";

const won = (n: number) => Number(n).toLocaleString("ko-KR");
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

type Row = {
  id: string;
  partner_id: string;
  period_start: string;
  period_end: string;
  title: string | null;
  amount: number;
  paid: boolean;
  paid_on: string | null;
  invoice_done: boolean;
  invoice_done_on: string | null;
  memo: string | null;
  viral_partners: { name: string } | null;
  viral_partner_statement_files: { id: string; file_name: string; storage_path: string }[];
};

const STATE = [
  { key: "", label: "전체" },
  { key: "unpaid", label: "입금 전" },
  { key: "invoice", label: "입금 완료 · 세금계산서 미발행" },
  { key: "done", label: "모두 완료" },
];

export default async function ViralStatements(props: PageProps<"/viral/statements">) {
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!canViewCost(me)) {
    return <p className="glass p-5 text-sm">협력사 견적서는 대표·팀장·공급가 보기 권한이 있는 사람만 볼 수 있습니다.</p>;
  }
  const partnerId = typeof sp.p === "string" ? sp.p : "";
  const state = typeof sp.s === "string" ? sp.s : "";
  const partners = await loadPartners(supabase);

  let q = supabase
    .from("viral_partner_statements")
    .select("id,partner_id,period_start,period_end,title,amount,paid,paid_on,invoice_done,invoice_done_on,memo,viral_partners(name),viral_partner_statement_files(id,file_name,storage_path)")
    .order("period_start", { ascending: false })
    .limit(300);
  if (partnerId) q = q.eq("partner_id", partnerId);
  if (state === "unpaid") q = q.eq("paid", false);
  if (state === "invoice") q = q.eq("paid", true).eq("invoice_done", false);
  if (state === "done") q = q.eq("paid", true).eq("invoice_done", true);
  const [{ data, error }, { data: linked }] = await Promise.all([
    q.returns<Row[]>(),
    supabase.from("viral_orders").select("partner_statement_id").not("partner_statement_id", "is", null),
  ]);
  const rows = data ?? [];
  const linkCount = new Map<string, number>();
  for (const l of linked ?? []) linkCount.set(l.partner_statement_id!, (linkCount.get(l.partner_statement_id!) ?? 0) + 1);
  const links = await signedLinks(supabase, rows.flatMap((r) => r.viral_partner_statement_files.map((f) => f.storage_path)));

  const unpaid = rows.filter((r) => !r.paid);
  const waitingInvoice = rows.filter((r) => r.paid && !r.invoice_done);
  const href = (p: string, s: string) => `/viral/statements?${new URLSearchParams({ ...(p ? { p } : {}), ...(s ? { s } : {}) })}`;

  return (
    <div className="space-y-4">
      <Link href="/viral" className="text-sm text-ink-soft hover:text-brand">← 바이럴 목록</Link>
      <header>
        <h1 className="text-2xl font-bold">협력사 견적서</h1>
        <p className="text-sm text-ink-soft">
          협력사가 매월·매주 보내 주는 사용 내역 견적서를 올리고, 협력사 입금 → 광고주 세금계산서 발행 순서로 체크합니다.
          견적서에 바이럴 건을 연결해 두면 체크할 때 그 건들의 결제·발행 상태도 같이 바뀝니다.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="glass p-4"><p className="text-xs text-ink-soft">협력사 입금 전</p><p className="text-xl font-bold tabular-nums">{unpaid.length}건 · {won(unpaid.reduce((t, r) => t + Number(r.amount), 0))}원</p></div>
        <div className="glass p-4"><p className="text-xs text-ink-soft">입금 완료 · 세금계산서 미발행</p><p className="text-xl font-bold tabular-nums">{waitingInvoice.length}건</p></div>
        <div className="glass p-4"><p className="text-xs text-ink-soft">표시 중인 견적서</p><p className="text-xl font-bold tabular-nums">{rows.length}건 · {won(rows.reduce((t, r) => t + Number(r.amount), 0))}원</p></div>
      </div>

      <details className="glass p-4" open={!rows.length}>
        <summary className="cursor-pointer text-sm font-bold">견적서 올리기</summary>
        <div className="mt-3"><StatementForm action={createStatement} partners={partners} submitLabel="저장하고 바이럴 건 연결하기" /></div>
      </details>

      <nav className="flex flex-wrap gap-2 text-sm">
        <Link href={href("", state)} className={`chip ${!partnerId ? "chip-info" : "chip-muted"}`}>모든 협력사</Link>
        {partners.map((p) => <Link key={p.id} href={href(p.id, state)} className={`chip ${partnerId === p.id ? "chip-info" : "chip-muted"}`}>{p.name}</Link>)}
        <span className="mx-1 text-ink-soft">|</span>
        {STATE.map((x) => <Link key={x.key} href={href(partnerId, x.key)} className={`chip ${state === x.key ? "chip-info" : "chip-muted"}`}>{x.label}</Link>)}
      </nav>

      {error && <p className="glass p-3 text-sm text-danger">목록을 불러오지 못했습니다: {error.message}</p>}
      <div className="glass overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="text-left text-xs text-ink-soft">
            <tr>
              <th className="px-3 py-2">협력사</th><th className="px-3">기간</th><th className="px-3">이름</th>
              <th className="px-3 text-right">견적 금액(VAT포함)</th><th className="px-3">파일</th><th className="px-3 text-right">연결 건</th>
              <th className="px-3">① 협력사 입금</th><th className="px-3">② 광고주 세금계산서</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--glass-border)] align-top">
                <td className="whitespace-nowrap px-3 py-2 font-semibold">{r.viral_partners?.name}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.period_start.slice(0, 4)} {md(r.period_start)}~{md(r.period_end)}</td>
                <td className="px-3 py-2"><Link href={`/viral/statements/${r.id}`} className="text-brand underline">{r.title || "견적서"}</Link></td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{won(r.amount)}</td>
                <td className="px-3 py-2">
                  {r.viral_partner_statement_files.map((f) => (
                    <a key={f.id} href={links[f.storage_path]} target="_blank" rel="noreferrer" className="block max-w-[180px] truncate text-xs text-brand underline">{f.file_name}</a>
                  ))}
                  {!r.viral_partner_statement_files.length && <span className="text-xs text-[var(--warn-ink)]">파일 없음</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{linkCount.get(r.id) ?? 0}건</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <form action={setStatementFlag.bind(null, r.id, "paid", !r.paid)}>
                    <button className={`chip ${r.paid ? "chip-ok" : "chip-warn"}`} title={r.paid ? "누르면 입금 전으로 되돌립니다" : "누르면 입금 완료로 체크합니다"}>
                      {r.paid ? `☑ 입금 ${r.paid_on ? md(r.paid_on) : ""}` : "☐ 입금 전"}
                    </button>
                  </form>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.paid ? (
                    <form action={setStatementFlag.bind(null, r.id, "invoice_done", !r.invoice_done)}>
                      <button className={`chip ${r.invoice_done ? "chip-ok" : "chip-warn"}`} title={r.invoice_done ? "누르면 미발행으로 되돌립니다" : "누르면 발행 완료로 체크합니다"}>
                        {r.invoice_done ? `☑ 발행 ${r.invoice_done_on ? md(r.invoice_done_on) : ""}` : "☐ 미발행"}
                      </button>
                    </form>
                  ) : (
                    <span className="chip chip-muted" title="협력사 입금을 먼저 체크하세요">입금 후 체크</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="px-3 py-4 text-ink-soft">아직 올린 견적서가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
