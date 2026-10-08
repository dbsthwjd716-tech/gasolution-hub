import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/supabase/server";

// 수집기용 데이터베이스 연결: 로그인 없이, 요청에 실려 온 수집기 열쇠로만 ads_* 쓰기 함수를 부름
export function adsDb() {
  const { url, key } = supabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function adsRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await adsDb().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

// 예전 대시보드 표 한 쪽 읽기 (허브 토큰)
export async function legacyTablePage(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]> {
  const url = process.env.DASHBOARD_SUPABASE_URL;
  const key = process.env.DASHBOARD_SUPABASE_KEY;
  const token = process.env.DASHBOARD_HUB_TOKEN;
  if (!url || !key || !token) throw new Error("예전 대시보드 연결 설정이 없습니다");
  const res = await fetch(`${url}/rest/v1/rpc/hub_table_export`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token, p_table: table, p_offset: offset, p_limit: limit }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`예전 표 읽기 실패 ${table} (${res.status})`);
  return (await res.json()) as Record<string, unknown>[];
}
