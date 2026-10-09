import "server-only";
import { createHmac } from "node:crypto";
import { adsRpc } from "@/lib/ads-db";

// 수집기 공통: 금고에서 꺼낸 키, 통합 DB 읽기·쓰기, 네이버 검색광고 호출
//   비밀값은 수집 함수 안에서만 쓰고 결과·기록에는 남기지 않음

export type Credential = { advertiser_id: number; platform: "naver_searchad" | "meta"; account_id: string; status: string; api_key: string | null; secret: string | null };
export type Secrets = { env: Record<string, string>; credentials: Credential[] };
export type Advertiser = {
  id: number; name: string | null; customer_id: string | null; manager: string | null; mapped_at: string | null;
  credential_group: string | null; adcost_source: "auto" | "naver_api" | "transferred"; transferred_at: string | null;
};

export const loadSecrets = (token: string) => adsRpc<Secrets>("ads_collector_secrets", { p_token: token });
export const readData = <T>(token: string, what: string, args: Record<string, unknown> = {}) =>
  adsRpc<T>("ads_collector_read", { p_token: token, p_what: what, p_args: args });

// 통합 DB에 저장 (같은 키면 새 값으로). 모든 줄이 같은 열을 갖도록 넘겨야 함
export async function saveRows(token: string, table: string, rows: Record<string, unknown>[]) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) n += await adsRpc<number>("ads_import", { p_token: token, p_table: table, p_rows: rows.slice(i, i + 500) });
  return n;
}

export function kstDate(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
export function daysInclusive(a: string, b: string) {
  return Math.floor((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}

// 일 여러 개를 동시에 몇 개씩
export async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>, stop?: () => boolean) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      if (stop?.()) return;
      await fn(items[i++]);
    }
  }));
}

// ---------------------------------------------------------------- 네이버 검색광고
export type NaverKeys = { apiKey: string; secretKey: string; source: "advertiser" | "group" };
export type NaverResult = { ok: boolean; status: number; data: unknown };

// 키 고르기: 광고주 본인 API(사용 가능 상태) → 없거나 거부되면 담당자 그룹 키(NAVER_<GROUP>_*) (예전 대시보드와 같음)
export class NaverKeyBook {
  private advertiserKeys = new Map<number, NaverKeys>();
  private rejected = new Set<number>();
  deadline = Infinity; // 이 시각이 지나면 네이버 재시도를 하지 않음
  constructor(private secrets: Secrets, private token: string) {
    for (const c of secrets.credentials) {
      if (c.platform === "naver_searchad" && ["valid", "unverified"].includes(c.status) && c.api_key && c.secret) {
        this.advertiserKeys.set(Number(c.advertiser_id), { apiKey: c.api_key, secretKey: c.secret, source: "advertiser" });
      }
    }
  }
  group(adv: Advertiser): NaverKeys | null {
    const g = String(adv.credential_group ?? "").trim().toUpperCase();
    const e = this.secrets.env;
    if (!g || !e[`NAVER_${g}_API_KEY`] || !e[`NAVER_${g}_SECRET_KEY`]) return null;
    return { apiKey: e[`NAVER_${g}_API_KEY`], secretKey: e[`NAVER_${g}_SECRET_KEY`], source: "group" };
  }
  pick(adv: Advertiser): NaverKeys | null {
    return (!this.rejected.has(adv.id) && this.advertiserKeys.get(adv.id)) || this.group(adv);
  }
  // 광고주 키가 네이버에서 거부됨 → '확인 필요'로 표시하고 그룹 키로
  async reject(adv: Advertiser, status: number, message: string) {
    if (this.rejected.has(adv.id)) return;
    this.rejected.add(adv.id);
    await adsRpc("ads_mark_credential", { p_token: this.token, p_advertiser_id: adv.id, p_platform: "naver_searchad", p_status: "invalid", p_message: message || `네이버 인증 오류 (${status})` }).catch(() => {});
  }
}

// 네이버가 "요청이 너무 많음(429)"이나 일시 오류(5xx·연결 끊김)를 주면 잠깐 쉬었다가 다시 (최대 4번, 1·2·4·8초 + 흔들기)
export const naverRetryable = (status: number) => status === 429 || status >= 500;
//   deadline(시각, ms)을 주면 쉬고 다시 부를 시간이 없을 때는 더 기다리지 않음 (서버 실행 한도 300초 안에 끝내려고)
export async function naverGet(keys: NaverKeys, customerId: string, uri: string, query?: URLSearchParams, deadline = Infinity): Promise<NaverResult> {
  let r = await naverGetOnce(keys, customerId, uri, query);
  for (let i = 0; i < 4 && naverRetryable(r.status); i++) {
    const wait = 1000 * 2 ** i + Math.floor(Math.random() * 500);
    if (Date.now() + wait + NAVER_TIMEOUT_MS > deadline) break;
    await new Promise((ok) => setTimeout(ok, wait));
    r = await naverGetOnce(keys, customerId, uri, query);
  }
  return r;
}
const NAVER_TIMEOUT_MS = 20_000;

async function naverGetOnce(keys: NaverKeys, customerId: string, uri: string, query?: URLSearchParams): Promise<NaverResult> {
  const ts = Date.now().toString();
  const sig = createHmac("sha256", keys.secretKey).update(`${ts}.GET.${uri}`).digest("base64");
  try {
    const res = await fetch(`https://api.searchad.naver.com${uri}${query ? `?${query}` : ""}`, {
      headers: { "X-Timestamp": ts, "X-API-KEY": keys.apiKey, "X-Customer": customerId, "X-Signature": sig, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(NAVER_TIMEOUT_MS),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 502, data: { message: e instanceof Error ? e.message : "네이버 연결 실패" } };
  }
}

// 광고주 키로 부르고, 401·403이면 그룹 키로 한 번 더 (같은 요청 안에서)
export async function naverCall(book: NaverKeyBook, adv: Advertiser, uri: string, query?: URLSearchParams): Promise<NaverResult & { keySource: string | null }> {
  const keys = book.pick(adv);
  if (!keys) return { ok: false, status: 500, data: { message: "광고주 API 정보 또는 담당자 그룹 키가 없습니다." }, keySource: null };
  const r = await naverGet(keys, String(adv.customer_id), uri, query, book.deadline);
  if (keys.source === "advertiser" && (r.status === 401 || r.status === 403)) {
    const d = r.data as { title?: string; detail?: string } | null;
    await book.reject(adv, r.status, d?.title || d?.detail || "");
    const g = book.group(adv);
    if (g) return { ...(await naverGet(g, String(adv.customer_id), uri, query, book.deadline)), keySource: "group" };
  }
  return { ...r, keySource: keys.source };
}

export const naverMessage = (d: unknown) => {
  const x = d as { message?: string; title?: string; detail?: string } | null;
  return String(x?.message || x?.title || x?.detail || "").slice(0, 200) || null;
};
