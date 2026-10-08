import Link from "next/link";
import { getMe } from "@/lib/supabase/server";
import { fetchAccounts } from "@/lib/legacy-accounts";
import { fetchCredentials } from "@/lib/legacy-credentials";
import { addAccount, editAccount, revealApi, saveApi, uploadTransferred } from "../accounts-actions";
import { AddAccountForm, ApiForm, EditAccountForm, RevealApi, UploadForm } from "../accounts-forms";

const SOURCE: Record<string, { label: string; chip: string }> = {
  auto: { label: "자동", chip: "chip-muted" },
  naver_api: { label: "네이버 API", chip: "chip-ok" },
  transferred: { label: "피이관", chip: "chip-warn" },
};
const kst = (ts: string | null) =>
  ts ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)) : "-";

// 광고주 등록 · 피이관: 예전 대시보드 '계정 관리'와 '피이관 실적 업로드'를 옮김 (저장은 예전 대시보드 표 → 아침 수집 그대로)
export default async function Accounts(props: PageProps<"/ads/accounts">) {
  const sp = await props.searchParams;
  const { me, supabase } = await getMe();
  if (!me || me.role === "staff") return <p className="glass p-5 text-sm">광고주 등록·피이관 업로드는 대표·팀장만 할 수 있습니다.</p>;
  const canReveal = me.role === "ceo" || me.role === "lead";
  const [{ data, error }, creds, { data: views }] = await Promise.all([
    fetchAccounts(),
    fetchCredentials(),
    supabase.from("api_reveal_log").select("id,advertiser_name,platform,viewed_at,staff:staff_id(name)").order("viewed_at", { ascending: false }).limit(30),
  ]);
  if (!data) return <p className="glass p-5 text-sm text-danger">{error}</p>;
  const credBy = new Map((creds.data?.advertisers ?? []).map((c) => [c.id, c]));
  const apiCount = (creds.data?.advertisers ?? []).filter((c) => c.naver || c.meta).length;
  const apiBad = (creds.data?.advertisers ?? []).filter((c) => c.naver?.status === "invalid" || c.meta?.status === "invalid").length;

  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const src = typeof sp.s === "string" ? sp.s : "";
  const apiFilter = typeof sp.api === "string" ? sp.api : "";
  const who = typeof sp.m === "string" ? sp.m : "";
  const list = data.advertisers.filter(
    (a) =>
      (!src || a.adcost_source === src) &&
      (!apiFilter || (apiFilter === "on" ? !!(credBy.get(a.id)?.naver || credBy.get(a.id)?.meta) : apiFilter === "bad" ? credBy.get(a.id)?.naver?.status === "invalid" || credBy.get(a.id)?.meta?.status === "invalid" : !(credBy.get(a.id)?.naver || credBy.get(a.id)?.meta))) &&
      (!who || a.manager === who) &&
      (!q || `${a.name} ${a.customer_id ?? ""} ${a.gfa_ad_account_no ?? ""} ${a.meta_account ?? ""} ${a.group_name ?? ""}`.toLowerCase().includes(q)),
  );
  const transferred = data.advertisers.filter((a) => a.adcost_source === "transferred").length;
  const t = data.transferred;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">광고주 등록 · 피이관</h1>
        <p className="text-sm text-ink-soft">아침 비즈머니·검색광고 수집은 아직 예전 대시보드가 하기 때문에, 여기서 등록·업로드한 내용은 예전 대시보드에도 그대로 저장됩니다. 예전 대시보드에 들어갈 필요는 없습니다.</p>
      </header>

      <section className="glass p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">피이관 · 유상실적 업로드</h2>
          <p className="text-xs text-ink-soft">지금 반영: <b>{t.through ?? "없음"}</b>까지 · 마지막 업로드 {kst(t.last_import)}</p>
        </div>
        <p className="mt-1 text-xs text-ink-soft">
          네이버에서 받은 유상실적 CSV를 그대로 올리면 됩니다 (열: 날짜 · 광고계정 CustomerID · 광고주명 · 유상실적TOTAL). 같은 계정·날짜는 새 값으로 바뀌니 겹쳐 올려도 됩니다.
          이 파일이 피이관 광고주 소진, 광고비 실적의 네이버 금액, 주간 프로모션 계산에 쓰이니 자주 올려 주세요.
        </p>
        <div className="mt-3"><UploadForm action={uploadTransferred} /></div>
      </section>

      <section className="glass border-dashed p-5 text-sm">
        <h2 className="font-bold">새 피이관 업체가 생기면</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-soft">
          <li>아래 「광고주 등록」에서 <b>네이버 검색광고</b>로 등록하고, 실적 기준을 <b>피이관</b>, 피이관 시작일을 넣습니다. (이미 등록된 광고주면 목록에서 「수정」 → 실적 기준을 피이관으로)</li>
          <li>그 기간이 들어간 <b>유상실적 CSV</b>를 위에서 올립니다. 그 뒤로도 정기적으로 올려 주세요.</li>
          <li>세금계산서를 보낼 곳이면 <Link href="/clients/new" className="text-brand underline">거래처</Link>에도 등록합니다.</li>
        </ol>
      </section>

      <section className="glass p-5">
        <h2 className="mb-3 font-bold">광고주 등록</h2>
        <AddAccountForm action={addAccount} groups={data.groups} employees={data.employees} />
      </section>

      <section className="glass p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">등록된 광고주 {data.advertisers.length}곳 <span className="text-xs font-normal text-ink-soft">· 피이관 {transferred}곳 · API 연동 {apiCount}곳{apiBad ? ` · API 확인 필요 ${apiBad}곳` : ""}</span>{creds.error && <span className="ml-2 text-xs font-normal text-danger">API 상태를 못 읽음: {creds.error}</span>}</h2>
          <form className="flex flex-wrap gap-2">
            <select name="m" defaultValue={who} className="field !w-auto" aria-label="담당자">
              <option value="">전체 담당자</option>
              {data.employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
            <select name="s" defaultValue={src} className="field !w-auto" aria-label="실적 기준">
              <option value="">모든 기준</option>
              <option value="transferred">피이관만</option>
              <option value="auto">자동</option>
              <option value="naver_api">네이버 API</option>
            </select>
            <select name="api" defaultValue={apiFilter} className="field !w-auto" aria-label="API">
              <option value="">API 전체</option>
              <option value="on">API 연동됨</option>
              <option value="bad">API 확인 필요</option>
              <option value="off">API 없음</option>
            </select>
            <input name="q" defaultValue={q} placeholder="광고주·ID·그룹" className="field !w-48" aria-label="검색" />
            <button className="btn btn-ghost">찾기</button>
          </form>
        </div>
        <ul className="mt-3 divide-y divide-[#edf1f7] text-sm">
          {list.slice(0, 200).map((a) => (
            <li key={a.id} className="py-2.5">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`chip ${SOURCE[a.adcost_source]?.chip ?? "chip-muted"}`}>{SOURCE[a.adcost_source]?.label ?? a.adcost_source}</span>
                  <b className="min-w-0">{a.name}</b>
                  <span className="text-xs text-ink-soft">
                    {a.customer_id ? `SA ${a.customer_id}` : ""}{a.gfa_ad_account_no ? ` · GFA ${a.gfa_ad_account_no}` : ""}{a.meta_account ? ` · ${a.meta_account}` : ""}
                    {` · ${a.manager ?? "담당 없음"} · ${a.group_name ?? "그룹 없음"}`}{a.mapped_at ? ` · 매핑 ${a.mapped_at}` : ""}{a.transferred_at && a.adcost_source === "transferred" ? ` · 피이관 ${a.transferred_at}~` : ""}
                  </span>
                  {(() => {
                    const c = credBy.get(a.id);
                    const st = c?.naver?.status ?? c?.meta?.status;
                    return st ? <span className={`chip ${st === "invalid" ? "chip-danger" : "chip-ok"} !text-[10.5px]`}>API {st === "invalid" ? "확인 필요" : "연동"}</span> : null;
                  })()}
                  <span className="ml-auto text-xs text-brand">수정 · API</span>
                </summary>
                <div className="mt-2 space-y-2">
                  <EditAccountForm action={editAccount.bind(null, a.id)} groups={data.groups} source={a.adcost_source} transferredAt={a.transferred_at} groupId={a.group_id} />
                  {a.customer_id && <ApiForm action={saveApi.bind(null, a.id, "naver_searchad")} platform="naver_searchad" info={credBy.get(a.id)?.naver ?? null} accountId={a.customer_id} revealSlot={canReveal ? <RevealApi reveal={revealApi.bind(null, a.id, a.name, "naver_searchad")} platform="naver_searchad" /> : null} />}
                  {a.meta_account && <ApiForm action={saveApi.bind(null, a.id, "meta")} platform="meta" info={credBy.get(a.id)?.meta ?? null} accountId={a.meta_account} revealSlot={canReveal ? <RevealApi reveal={revealApi.bind(null, a.id, a.name, "meta")} platform="meta" /> : null} />}
                </div>
              </details>
            </li>
          ))}
          {!list.length && <li className="py-4 text-center text-ink-soft">조건에 맞는 광고주가 없습니다.</li>}
        </ul>
        {list.length > 200 && <p className="mt-2 text-xs text-ink-soft">처음 200곳만 보입니다. 검색으로 좁혀 주세요.</p>}
      </section>

      <details className="glass p-5 text-sm">
        <summary className="cursor-pointer font-bold">API 값 열람 기록 <span className="text-xs font-normal text-ink-soft">최근 30건 · 대표·팀장만 보임</span></summary>
        <ul className="mt-2 divide-y divide-[#edf1f7] text-xs">
          {(views ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap gap-2 py-1.5">
              <span className="w-28 text-ink-soft">{kst(v.viewed_at)}</span>
              <b>{(v.staff as unknown as { name: string } | null)?.name ?? "-"}</b>
              <span>{v.advertiser_name ?? "-"}</span>
              <span className="text-ink-soft">{v.platform === "meta" ? "Meta 토큰" : "네이버 API"}</span>
            </li>
          ))}
          {!views?.length && <li className="py-2 text-ink-soft">아직 열람 기록이 없습니다.</li>}
        </ul>
      </details>
    </div>
  );
}
