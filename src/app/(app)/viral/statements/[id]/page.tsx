import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewCost, getMe } from "@/lib/supabase/server";
import { signedLinks } from "@/lib/storage";
import { ConfirmSubmit } from "../../../billing/panel";
import { loadPartners } from "../../data";
import { addStatementFiles, deleteStatement, deleteStatementFile, linkOrders, setStatementFlag, updateStatement } from "../actions";
import { LinkOrdersForm, StatementFilesForm, StatementForm, type LinkRow } from "../forms";

const won = (n: number) => Number(n).toLocaleString("ko-KR");
const INVOICE: Record<string, string> = { not_issued: "미발행", requested: "요청함", issued: "발행", not_needed: "안 함" };

function shift(d: string, days: number) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

type ListRow = { id: string; paid_date: string | null; company_name: string; first_item_description: string | null; description: string | null; staff_name: string | null; sale_amount: number; partner_paid: boolean; invoice_status: string };
const LIST_COLS = "id,paid_date,company_name,first_item_description,description,staff_name,sale_amount,partner_paid,invoice_status";

export default async function ViralStatement(props: PageProps<"/viral/statements/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const { supabase, me } = await getMe();
  if (!canViewCost(me)) {
    return <p className="glass p-5 text-sm">협력사 견적서는 대표·팀장·공급가 보기 권한이 있는 사람만 볼 수 있습니다.</p>;
  }
  const { data: st } = await supabase
    .from("viral_partner_statements")
    .select("*,viral_partners(name),viral_partner_statement_files(id,file_name,storage_path,created_at)")
    .eq("id", id)
    .maybeSingle();
  if (!st) notFound();
  const isManager = me?.role === "ceo" || me?.role === "lead";
  const wide = sp.all === "1";

  // 후보: 같은 협력사 건 중 (이미 이 견적서에 연결된 건) + (기간 2주 전 ~ 기간 끝 사이 입금 건, 넓게 보기면 최근 6개월)
  const from = wide ? shift(st.period_start, -183) : shift(st.period_start, -14);
  const [partners, { data: linkedIds }, { data: windowRows }] = await Promise.all([
    loadPartners(supabase),
    supabase.from("viral_orders").select("id").eq("partner_statement_id", id),
    supabase.from("viral_orders_list").select(LIST_COLS).eq("partner_id", st.partner_id).gte("paid_date", from).lte("paid_date", shift(st.period_end, wide ? 31 : 0)).order("paid_date").returns<ListRow[]>(),
  ]);
  const linkedSet = new Set((linkedIds ?? []).map((x) => x.id));
  const missing = [...linkedSet].filter((x) => !(windowRows ?? []).some((r) => r.id === x));
  const { data: extra } = missing.length
    ? await supabase.from("viral_orders_list").select(LIST_COLS).in("id", missing).returns<ListRow[]>()
    : { data: [] as ListRow[] };
  const all = [...(extra ?? []), ...(windowRows ?? [])];
  const ids = all.map((r) => r.id);

  const [{ data: costs }, { data: stmtOf }] = await Promise.all([
    ids.length ? supabase.rpc("viral_order_costs", { ids }) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("viral_orders").select("id,partner_statement_id").in("id", ids) : Promise.resolve({ data: [] }),
  ]);
  const cost = new Map(((costs ?? []) as { id: string; cost_amount: number }[]).map((c) => [c.id, Number(c.cost_amount)]));
  const otherStmtIds = [...new Set(((stmtOf ?? []) as { id: string; partner_statement_id: string | null }[]).map((x) => x.partner_statement_id).filter((x): x is string => !!x && x !== id))];
  const { data: others } = otherStmtIds.length
    ? await supabase.from("viral_partner_statements").select("id,title,period_start,period_end").in("id", otherStmtIds)
    : { data: [] };
  const otherName = new Map((others ?? []).map((o) => [o.id, o.title || `${o.period_start.slice(5)}~${o.period_end.slice(5)} 견적서`]));
  const stmtMap = new Map(((stmtOf ?? []) as { id: string; partner_statement_id: string | null }[]).map((x) => [x.id, x.partner_statement_id]));

  const rows: LinkRow[] = all.map((r) => {
    const sid = stmtMap.get(r.id) ?? null;
    return {
      id: r.id,
      paid_date: r.paid_date,
      company_name: r.company_name,
      description: r.first_item_description ?? r.description,
      staff_name: r.staff_name,
      cost_amount: cost.get(r.id) ?? null,
      sale_amount: Number(r.sale_amount),
      partner_paid: r.partner_paid,
      invoice_label: INVOICE[r.invoice_status] ?? r.invoice_status,
      linked_here: linkedSet.has(r.id),
      linked_elsewhere: sid && sid !== id ? (otherName.get(sid) ?? "다른 견적서") : null,
    };
  });
  const files = (st.viral_partner_statement_files ?? []) as { id: string; file_name: string; storage_path: string; created_at: string }[];
  const links = await signedLinks(supabase, files.map((f) => f.storage_path));
  const linkedRows = rows.filter((r) => r.linked_here);
  const notIssued = linkedRows.filter((r) => r.invoice_label === "미발행" || r.invoice_label === "요청함").length;

  return (
    <div className="space-y-4">
      <Link href="/viral/statements" className="text-sm text-ink-soft hover:text-brand">← 협력사 견적서 목록</Link>
      <header className="glass flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h1 className="text-xl font-bold">{st.viral_partners?.name} · {st.title || "견적서"}</h1>
          <p className="mt-1 text-sm text-ink-soft tabular-nums">{st.period_start} ~ {st.period_end} · 견적 금액 <b className="text-ink">{won(st.amount)}원</b> (VAT 포함) · 연결 {linkedRows.length}건</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={setStatementFlag.bind(null, id, "paid", !st.paid)}>
            <button className={`btn ${st.paid ? "btn-ghost" : ""}`}>{st.paid ? `① 협력사 입금 완료 ${st.paid_on ?? ""} (되돌리기)` : "① 협력사 입금 완료로 체크"}</button>
          </form>
          {st.paid ? (
            <form action={setStatementFlag.bind(null, id, "invoice_done", !st.invoice_done)}>
              <button className={`btn ${st.invoice_done ? "btn-ghost" : ""}`}>{st.invoice_done ? `② 세금계산서 발행 완료 ${st.invoice_done_on ?? ""} (되돌리기)` : "② 광고주 세금계산서 발행 완료로 체크"}</button>
            </form>
          ) : (
            <span className="chip chip-muted">② 세금계산서는 입금 후 체크</span>
          )}
        </div>
      </header>
      {st.paid && !st.invoice_done && linkedRows.length > 0 && (
        <p className="glass p-3 text-sm">연결된 {linkedRows.length}건 중 세금계산서 미발행 {notIssued}건. ②를 체크하면 미발행·요청함 건이 모두 &lsquo;발행&rsquo;으로 바뀝니다 (&lsquo;안 함&rsquo; 건은 그대로).</p>
      )}

      <section className="glass p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">이 견적서에 들어 있는 바이럴 건</h2>
          <Link href={wide ? `/viral/statements/${id}` : `/viral/statements/${id}?all=1`} className="text-xs text-brand underline">
            {wide ? "기간 근처 건만 보기" : "최근 6개월 건까지 넓게 보기"}
          </Link>
        </div>
        <p className="mb-2 text-xs text-ink-soft">기간 시작 2주 전부터 기간 끝까지 입금된 {st.viral_partners?.name} 건입니다. 견적서에 있는 건을 체크하고 저장하세요. 공급가 합계가 견적 금액과 맞는지 바로 보여 줍니다.</p>
        <LinkOrdersForm key={[...linkedSet].sort().join(",")} action={linkOrders.bind(null, id)} rows={rows} statementAmount={Number(st.amount)} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="glass p-5">
          <h2 className="mb-3 font-bold">견적서 정보</h2>
          <StatementForm action={updateStatement.bind(null, id)} partners={partners} initial={st} submitLabel="저장" withFiles={false} />
        </section>
        <section className="glass space-y-3 p-5">
          <h2 className="font-bold">견적서 파일</h2>
          <ul className="space-y-1 text-sm">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <a href={links[f.storage_path]} target="_blank" rel="noreferrer" className="truncate text-brand underline">{f.file_name}</a>
                <ConfirmSubmit action={deleteStatementFile.bind(null, id, f.id)} label="삭제" confirmText="이 파일을 지울까요?" />
              </li>
            ))}
            {!files.length && <li className="text-xs text-[var(--warn-ink)]">아직 올린 파일이 없습니다.</li>}
          </ul>
          <StatementFilesForm action={addStatementFiles.bind(null, id)} />
          {isManager && (
            <div className="border-t border-[var(--glass-border)] pt-3">
              <ConfirmSubmit action={deleteStatement.bind(null, id)} label="이 견적서 삭제 (연결된 바이럴 건은 남음)" confirmText="이 견적서와 파일 기록을 지울까요? 바이럴 건은 지워지지 않습니다." />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
