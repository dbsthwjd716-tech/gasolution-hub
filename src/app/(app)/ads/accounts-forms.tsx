"use client";

import { useActionState, useState, type ReactNode } from "react";
import type { AccForm } from "./accounts-actions";

type Action = (p: AccForm, f: FormData) => Promise<AccForm>;
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

function Msg({ s }: { s: AccForm }) {
  if (s.error) return <p className="text-sm text-danger" role="alert">{s.error}</p>;
  if (s.ok) return <p className="text-sm text-[var(--ok-ink)]">{s.ok}</p>;
  return null;
}

export function UploadForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept=".csv,text/csv" className="field !w-auto" required aria-label="유상실적 CSV 파일" />
        <button className="btn" disabled={pending}>{pending ? "올리는 중… (잠시만요)" : "유상실적 업로드"}</button>
      </div>
      <Msg s={state} />
    </form>
  );
}

export function AddAccountForm({ action, groups, employees }: { action: Action; groups: { id: number; name: string }[]; employees: { id: number; name: string; has_credential: boolean }[] }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [type, setType] = useState("SA");
  const [group, setGroup] = useState("");
  const [source, setSource] = useState("auto");
  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {[["SA", "네이버 검색광고 (통합 계정 포함)"], ["GFA", "네이버 GFA 전용 (성과형)"], ["META", "메타"]].map(([v, l]) => (
          <label key={v} className="cursor-pointer">
            <input type="radio" name="type" value={v} checked={type === v} onChange={() => setType(v)} className="peer sr-only" />
            <span className="inline-block rounded-lg border border-[#dbe3ee] px-3 py-1.5 text-sm peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white">{l}</span>
          </label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-ink-soft">광고주명 *<input name="name" className="field mt-1" required placeholder="예: frim885-프라임파크골프-통합 계정" /></label>
        {type === "SA" && <label className="text-xs text-ink-soft">Customer ID *<input name="customer_id" inputMode="numeric" className="field mt-1" required placeholder="숫자" /></label>}
        {type !== "META" && <label className="text-xs text-ink-soft">GFA Account ID {type === "GFA" ? "*" : "(있으면)"}<input name="gfa_no" inputMode="numeric" className="field mt-1" required={type === "GFA"} placeholder="숫자" /></label>}
        {type === "META" && <label className="text-xs text-ink-soft">Meta 광고계정 ID *<input name="meta_id" className="field mt-1" required placeholder="act_123… 또는 숫자" /></label>}
        <label className="text-xs text-ink-soft">담당자 *
          <select name="manager" className="field mt-1" required defaultValue="">
            <option value="" disabled>고르기</option>
            {employees.map((e) => <option key={e.id} value={e.name} disabled={type !== "META" && !e.has_credential}>{e.name}{type !== "META" && !e.has_credential ? " (네이버 API 그룹 없음)" : ""}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-soft">광고주 그룹 *
          <select name="group_id" value={group} onChange={(e) => setGroup(e.target.value)} className="field mt-1" required>
            <option value="" disabled>고르기</option>
            <option value="new">+ 새 그룹 만들기</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        {group === "new" && <label className="text-xs text-ink-soft">새 그룹 이름 *<input name="new_group" className="field mt-1" required placeholder="보통 거래처(브랜드) 이름" /></label>}
        <label className="text-xs text-ink-soft">매핑일 (맡은 날)<input type="date" name="mapped_at" defaultValue={today()} className="field mt-1" /></label>
        {type === "META" && <label className="text-xs text-ink-soft">담당 시작일<input type="date" name="meta_from" defaultValue={today()} className="field mt-1" /></label>}
        {type === "SA" && (
          <label className="text-xs text-ink-soft">실적 기준
            <select name="adcost_source" value={source} onChange={(e) => setSource(e.target.value)} className="field mt-1">
              <option value="auto">자동 (네이버 API, 안 되면 유상실적)</option>
              <option value="naver_api">네이버 API만</option>
              <option value="transferred">피이관 (유상실적 파일 기준)</option>
            </select>
          </label>
        )}
        {type === "SA" && source === "transferred" && <label className="text-xs text-ink-soft">피이관 시작일 *<input type="date" name="transferred_at" className="field mt-1" required /></label>}
      </div>
      {type === "SA" && source !== "transferred" && (
        <div className="rounded-xl border border-dashed border-[#cddcff] bg-[#f7f9ff] p-3">
          <p className="text-xs font-semibold text-brand">네이버 검색광고 API (선택 · 광고주 계정의 API 라이선스)</p>
          <p className="mt-0.5 text-[11.5px] text-ink-soft">넣으면 등록하면서 네이버에 실제로 접속해 확인하고, 확인된 경우에만 암호화해 저장합니다. 비우면 담당자 공용 키로 수집합니다. 나중에 목록에서 넣어도 됩니다.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input name="api_key" autoComplete="off" placeholder="API 라이선스 (액세스 라이선스)" className="field" aria-label="API 라이선스" />
            <input name="secret_key" type="password" autoComplete="new-password" placeholder="비밀키" className="field" aria-label="비밀키" />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "등록 중…" : "광고주 등록"}</button>
        <Msg s={state} />
      </div>
    </form>
  );
}

export function EditAccountForm({ action, groups, source, transferredAt, groupId }: { action: Action; groups: { id: number; name: string }[]; source: string; transferredAt: string | null; groupId: number | null }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [src, setSrc] = useState(source);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-lg bg-[#f6f8fc] p-3">
      <label className="text-xs text-ink-soft">실적 기준
        <select name="adcost_source" value={src} onChange={(e) => setSrc(e.target.value)} className="field mt-1 !w-auto !py-1.5 text-xs">
          <option value="auto">자동</option>
          <option value="naver_api">네이버 API만</option>
          <option value="transferred">피이관</option>
        </select>
      </label>
      {src === "transferred" && <label className="text-xs text-ink-soft">피이관 시작일<input type="date" name="transferred_at" defaultValue={transferredAt ?? ""} className="field mt-1 !w-auto !py-1.5 text-xs" required /></label>}
      <label className="text-xs text-ink-soft">그룹
        <select name="group_id" defaultValue={groupId ?? ""} className="field mt-1 !w-auto !py-1.5 text-xs">
          <option value="">그대로</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      <button className="btn btn-ghost !px-3 !py-1.5 text-xs" disabled={pending}>{pending ? "…" : "저장"}</button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
      {state.ok && <span className="text-xs text-[var(--ok-ink)]">{state.ok}</span>}
    </form>
  );
}

// 광고주 API 연동: 네이버 검색광고(라이선스·비밀키) 또는 Meta(토큰). 비밀값은 다시 보이지 않고 끝 4자리만
export function ApiForm({ action, platform, info, accountId, revealSlot }: { action: Action; platform: "naver_searchad" | "meta"; info: { status: string; keyHint: string; statusMessage: string; lastVerifiedAt: string | null } | null; accountId: string; revealSlot?: ReactNode }) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const naver = platform === "naver_searchad";
  const tone = !info ? "chip-muted" : info.status === "invalid" ? "chip-danger" : info.status === "valid" ? "chip-ok" : "chip-warn";
  const label = !info ? "등록 안 됨 · 공용 키 사용" : info.status === "invalid" ? "확인 필요" : info.status === "valid" ? "정상" : "확인 전";
  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-[#e4eaf2] p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <b>{naver ? "네이버 검색광고 API" : "Meta API 토큰"}</b>
        <span className={`chip ${tone}`}>{label}</span>
        {info?.keyHint && <span className="text-ink-soft">끝자리 …{info.keyHint}</span>}
        {info?.statusMessage && <span className="text-ink-soft">{info.statusMessage}</span>}
        {info && revealSlot}
      </div>
      <input type="hidden" name="account_id" value={accountId} />
      <div className="grid gap-2 sm:grid-cols-2">
        {naver ? (
          <>
            <input name="api_key" autoComplete="off" placeholder={info ? "API 라이선스 (바꿀 때만)" : "API 라이선스"} className="field !py-1.5 text-xs" aria-label="API 라이선스" />
            <input name="secret_key" type="password" autoComplete="new-password" placeholder={info ? "비밀키 (바꿀 때만)" : "비밀키"} className="field !py-1.5 text-xs" aria-label="비밀키" />
          </>
        ) : (
          <input name="access_token" type="password" autoComplete="new-password" placeholder={info ? "액세스 토큰 (바꿀 때만)" : "액세스 토큰"} className="field !py-1.5 text-xs sm:col-span-2" aria-label="액세스 토큰" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button name="action" value="save" className="btn !px-3 !py-1.5 text-xs" disabled={pending}>{pending ? "네이버·Meta에 확인 중…" : info ? "바꾸기" : "확인 후 등록"}</button>
        {info && <button name="action" value="verify" className="btn btn-ghost !px-3 !py-1.5 text-xs" disabled={pending}>다시 확인</button>}
        {info && <button name="action" value="delete" className="text-xs text-danger underline" disabled={pending} onClick={(e) => { if (!window.confirm("API 연동을 해제할까요? 이후에는 담당자 공용 키로 수집합니다.")) e.preventDefault(); }}>연동 해제</button>}
        {state.error && <span className="text-xs text-danger">{state.error}</span>}
        {state.ok && <span className="text-xs text-[var(--ok-ink)]">{state.ok}</span>}
      </div>
    </form>
  );
}

// 대표·팀장: 저장된 API 값 보기 (누를 때마다 열람 기록, 1분 뒤 자동으로 가림)
export function RevealApi({ reveal, platform }: { reveal: () => Promise<{ error?: string; accountId?: string; apiKey?: string; secret?: string }>; platform: "naver_searchad" | "meta" }) {
  const [v, setV] = useState<{ error?: string; accountId?: string; apiKey?: string; secret?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState("");
  const open = async () => {
    setPending(true);
    const r = await reveal();
    setPending(false);
    setV(r);
    if (!r.error) setTimeout(() => setV(null), 60_000);
  };
  const copy = (k: string, t: string) => navigator.clipboard.writeText(t).then(() => { setCopied(k); setTimeout(() => setCopied(""), 1200); });
  if (!v || v.error) {
    return (
      <span className="inline-flex items-center gap-2">
        <button type="button" onClick={open} disabled={pending} className="text-xs font-semibold text-brand underline">{pending ? "가져오는 중…" : "값 보기"}</button>
        {v?.error && <span className="text-xs text-danger">{v.error}</span>}
      </span>
    );
  }
  const rows: [string, string][] = platform === "naver_searchad"
    ? [["고객 ID", v.accountId ?? ""], ["API 라이선스", v.apiKey ?? ""], ["비밀키", v.secret ?? ""]]
    : [["광고계정", v.accountId ?? ""], ["액세스 토큰", v.secret ?? ""]];
  return (
    <div className="w-full rounded-lg border border-[#f0d48a] bg-[#fffbf0] p-2 text-xs">
      {rows.map(([k, t]) => (
        <p key={k} className="flex items-center gap-2 py-0.5">
          <span className="w-20 shrink-0 text-ink-soft">{k}</span>
          <code className="min-w-0 flex-1 break-all font-mono">{t || "-"}</code>
          {t && <button type="button" onClick={() => copy(k, t)} className="shrink-0 text-brand underline">{copied === k ? "복사됨" : "복사"}</button>}
        </p>
      ))}
      <p className="mt-1 flex items-center justify-between text-[11px] text-[#7a5200]">
        <span>열람 기록이 남았습니다 · 1분 뒤 자동으로 가려집니다</span>
        <button type="button" onClick={() => setV(null)} className="underline">지금 가리기</button>
      </p>
    </div>
  );
}
