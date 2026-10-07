import Link from "next/link";
import { BOARD, followUp, formatKST, kstDate, LEAD_STATUSES, MEDIA, normalizeCompany, SOURCES, STATUS_CHIP, type LeadStatus } from "@/lib/leads";
import { loadLeads, loadOpenLeads, monthBounds, today, type LeadRow } from "@/lib/leads-data";
import { getMe } from "@/lib/supabase/server";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function LeadsPage(props: PageProps<"/leads">) {
  const sp = await props.searchParams;
  const t = today();
  const month = monthBounds(t.slice(0, 7));
  const from = isDate(str(sp.from)) ? str(sp.from) : month.from;
  const to = isDate(str(sp.to)) ? str(sp.to) : month.to;
  const view = str(sp.view) === "board" ? "board" : "list";
  const followOnly = str(sp.follow) === "1";
  const q = str(sp.q).trim();
  const status = str(sp.status);
  const owner = str(sp.owner);
  const source = str(sp.source);
  const media = str(sp.media);

  const { supabase, me } = await getMe();
  const [{ rows: ranged, error }, open, { data: staff }] = await Promise.all([
    followOnly ? Promise.resolve({ rows: [] as LeadRow[], error: null }) : loadLeads(supabase, from, to),
    loadOpenLeads(supabase),
    supabase.from("staff").select("id,name").eq("is_active", true).order("name"),
  ]);
  const needs = open.filter((l) => followUp(l, t).needed);
  const base = followOnly ? needs : ranged;

  const qn = normalizeCompany(q);
  const qd = q.replace(/\D/g, "");
  const rows = base.filter((l) => {
    if (q) {
      const hit =
        normalizeCompany(l.company_name).includes(qn) ||
        (l.contact_name ?? "").includes(q) ||
        (qd.length >= 3 && (l.phone_digits ?? "").includes(qd)) ||
        (l.inquiry_content ?? "").includes(q) ||
        (l.memo ?? "").includes(q);
      if (!hit) return false;
    }
    if (status && l.status !== status) return false;
    if (owner === "none" ? !!l.staff_id : owner === "me" ? l.staff_id !== me?.id : owner ? l.staff_id !== owner : false) return false;
    if (source && (source === "none" ? !!l.source : l.source !== source)) return false;
    if (media && (media === "none" ? l.media.length > 0 : !l.media.includes(media))) return false;
    return true;
  });

  const valid = rows.filter((l) => l.status !== "스팸");
  const count = (ss: string[]) => valid.filter((l) => ss.includes(l.status)).length;
  const pct = (n: number) => (valid.length ? `${Math.round((n / valid.length) * 1000) / 10}%` : "-");
  const contracted = count(["계약완료"]);
  const consulted = count(["상담중", "제안/견적", "검토중", "계약완료"]);
  const sources = [...new Set([...SOURCES, ...ranged.map((l) => l.source).filter(Boolean)])] as string[];

  const keep = { from, to, view, q, status, owner, source, media, follow: followOnly ? "1" : "" };
  const href = (o: Partial<typeof keep>) => ({ pathname: "/leads", query: Object.fromEntries(Object.entries({ ...keep, ...o }).filter(([, v]) => v)) });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">인입 문의</h1>
          <p className="text-sm text-ink-soft">광고 문의 → 상담 → 제안 → 계약. 상담 기록과 상태·담당 변경이 모두 남습니다.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/leads/stats" className="btn btn-ghost">통계</Link>
          <Link href="/leads/new" className="btn">문의 등록</Link>
        </div>
      </header>

      {needs.length > 0 && (
        <Link href={href({ follow: followOnly ? "" : "1" })} className={`glass flex items-center justify-between p-4 text-sm ${followOnly ? "ring-2 ring-[var(--warn-ink)]/40" : ""}`}>
          <span><span className="chip chip-warn mr-2">연락 필요 {needs.length}건</span>마지막 연락 후 3영업일이 지났거나 연락 예정일이 된 진행 중 문의 (기간 상관없음)</span>
          <span className="text-brand underline">{followOnly ? "전체 보기" : "모아 보기"}</span>
        </Link>
      )}

      <form className="glass grid gap-2 p-4 text-sm md:grid-cols-4 lg:grid-cols-8" action="/leads">
        <input type="hidden" name="view" value={view} />
        {followOnly && <input type="hidden" name="follow" value="1" />}
        <input type="date" name="from" defaultValue={from} className="field" aria-label="시작일" disabled={followOnly} />
        <input type="date" name="to" defaultValue={to} className="field" aria-label="종료일" disabled={followOnly} />
        <input name="q" defaultValue={q} placeholder="업체·담당자·연락처·내용" className="field lg:col-span-2" aria-label="검색" />
        <select name="status" defaultValue={status} className="field" aria-label="상태">
          <option value="">모든 상태</option>
          {LEAD_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select name="owner" defaultValue={owner} className="field" aria-label="담당">
          <option value="">모든 담당</option>
          <option value="me">내 담당</option>
          <option value="none">미배정</option>
          {(staff ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select name="source" defaultValue={source} className="field" aria-label="유입경로">
          <option value="">모든 유입경로</option>
          {sources.map((x) => <option key={x} value={x}>{x}</option>)}
          <option value="none">미지정</option>
        </select>
        <select name="media" defaultValue={media} className="field" aria-label="매체">
          <option value="">모든 매체</option>
          {MEDIA.map((x) => <option key={x} value={x}>{x}</option>)}
          <option value="none">미지정</option>
        </select>
        <div className="flex flex-wrap items-center gap-2 md:col-span-4 lg:col-span-8">
          <button className="btn">조회</button>
          <Link href={href({ q: "", status: "", owner: "", source: "", media: "", follow: "" })} className="text-xs text-ink-soft underline">필터 초기화</Link>
          <Link href={href({ from: month.from, to: month.to, follow: "" })} className="text-xs text-brand underline">이번 달</Link>
          <span className="ml-auto flex gap-1">
            <Link href={href({ view: "list" })} className={`rounded-lg px-3 py-1.5 font-semibold ${view === "list" ? "bg-brand text-white" : "hover:bg-brand-soft"}`}>목록</Link>
            <Link href={href({ view: "board" })} className={`rounded-lg px-3 py-1.5 font-semibold ${view === "board" ? "bg-brand text-white" : "hover:bg-brand-soft"}`}>보드</Link>
          </span>
        </div>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: followOnly ? "연락 필요 문의" : "문의 (스팸 제외)", value: `${valid.length}건` },
          { label: "상담 이상", value: `${consulted}건 · ${pct(consulted)}` },
          { label: "계약완료", value: `${contracted}건 · ${pct(contracted)}` },
          { label: "미배정", value: `${valid.filter((l) => !l.staff_id && !["종료", "계약실패"].includes(l.status)).length}건` },
        ].map((k) => (
          <div key={k.label} className="glass p-4">
            <p className="text-xs text-ink-soft">{k.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      {error && <p className="glass p-4 text-sm text-danger">목록을 불러오지 못했습니다: {error}</p>}

      {view === "list" ? (
        <div className="glass overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-left text-xs text-ink-soft">
              <tr className="border-b border-[var(--glass-border)]">
                <th className="px-4 py-3">문의일</th>
                <th className="px-4 py-3">업체</th>
                <th className="px-4 py-3">업체 담당자</th>
                <th className="px-4 py-3 text-right">월 예산</th>
                <th className="px-4 py-3">유입 · 매체</th>
                <th className="px-4 py-3">담당</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">다음 할 일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const f = followUp(l, t);
                return (
                  <tr key={l.id} className="border-b border-[var(--glass-border)] last:border-0 hover:bg-white/60">
                    <td className="px-4 py-3 tabular-nums">{formatKST(l.inquiry_at, false).replace(/^\d{4}년 /, "")}</td>
                    <td className="px-4 py-3 font-semibold">
                      <Link href={`/leads/${l.id}`} className="hover:text-brand">{l.company_name}</Link>
                      {l.client_id && <span className="chip chip-ok ml-1">거래처</span>}
                    </td>
                    <td className="px-4 py-3">{l.contact_name ?? "-"}<div className="text-xs text-ink-soft">{l.phone}</div></td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.monthly_budget ? l.monthly_budget.toLocaleString("ko-KR") : "-"}</td>
                    <td className="px-4 py-3">{l.source ?? "-"}<div className="text-xs text-ink-soft">{l.media.join(", ")}</div></td>
                    <td className="px-4 py-3">{l.staff_name ?? <span className="chip chip-warn">미배정</span>}</td>
                    <td className="px-4 py-3"><span className={`chip ${STATUS_CHIP[l.status as LeadStatus]}`}>{l.status}</span></td>
                    <td className="max-w-56 px-4 py-3 text-xs">
                      {f.needed ? <span className="chip chip-warn">연락 필요 · {f.reason}</span> : l.next_contact_on ? <span className="text-ink-soft">예정 {l.next_contact_on}</span> : <span className="line-clamp-1 text-ink-soft">{l.memo}</span>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && !error && <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-soft">해당하는 문의가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {BOARD.map((col) => {
            const items = rows.filter((l) => (col.statuses as string[]).includes(l.status));
            return (
              <section key={col.label} className="glass p-3">
                <h2 className="mb-2 flex items-center justify-between text-sm font-bold">{col.label}<span className="chip chip-muted">{items.length}</span></h2>
                <ul className="space-y-2">
                  {items.map((l) => {
                    const f = followUp(l, t);
                    return (
                      <li key={l.id}>
                        <Link href={`/leads/${l.id}`} className="block rounded-xl border border-[var(--glass-border)] bg-white/80 p-3 text-sm hover:border-brand">
                          <p className="font-semibold">{l.company_name}</p>
                          <p className="text-xs text-ink-soft">{l.staff_name ?? "미배정"} · {kstDate(l.inquiry_at).slice(5)}{l.status !== col.label && ` · ${l.status}`}</p>
                          {f.needed && <span className="chip chip-warn mt-1">연락 필요</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
