"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getMe } from "@/lib/supabase/server";
import { ADS_LEGACY_TAG, fetchBizmoney } from "@/lib/ads-legacy";

// 오늘의 운영 알림 '확인' — 담당자는 예전 대시보드 기록에서 다시 찾음 (화면에서 보낸 값을 믿지 않음)
export async function ackAlert(key: string) {
  const { supabase, me } = await getMe();
  if (!me) return;
  const customerId = key.split(":")[1] ?? null;
  const { data } = await fetchBizmoney();
  const manager = data?.rows.find((r) => String(r.customer_id) === customerId)?.manager ?? null;
  await supabase.from("ads_alert_acks").insert({ alert_key: key, customer_id: customerId, manager });
  revalidatePath("/ads/today");
  revalidatePath("/home");
}

// 서진원 인계건 지정 / 해제 (대표·팀장, 데이터베이스 규칙으로도 막힘)
export async function setHandover(customerId: string, name: string, on: boolean) {
  const { supabase, me } = await getMe();
  if (!me || me.role === "staff" || !/^\d+$/.test(customerId)) return;
  if (on) await supabase.from("handover_accounts").upsert({ customer_id: customerId, advertiser_name: name || null });
  else await supabase.from("handover_accounts").delete().eq("customer_id", customerId);
  revalidatePath("/ads/spend");
}

// 오늘의 운영 알림 여러 건 한꺼번에 '확인' (체크한 것 / 항목 전체 / 한 줄)
//   담당자는 예전 대시보드 기록에서 다시 찾음 → 직원은 본인 담당만 저장됨 (데이터베이스 규칙)
export async function ackAlerts(formData: FormData) {
  const { supabase, me } = await getMe();
  if (!me) return;
  const today = (await import("@/lib/billing-calc")).todayKST();
  const keys = [...new Set(formData.getAll("key").map(String))].filter((k) => k.endsWith(`:${today}`)).slice(0, 500);
  if (!keys.length) return;
  const { fetchRoasWatch } = await import("@/lib/ads-legacy");
  const [biz, roas] = await Promise.all([fetchBizmoney(), keys.some((k) => k.startsWith("roas")) ? fetchRoasWatch() : Promise.resolve({ data: undefined })]);
  const mgr = new Map<string, string | null>();
  for (const r of roas.data?.rows ?? []) mgr.set(String(r.customer_id), r.manager);
  for (const r of biz.data?.rows ?? []) mgr.set(String(r.customer_id), r.manager);
  const rows = keys
    .map((k) => {
      const customerId = k.split(":")[1] ?? null;
      return { alert_key: k, customer_id: customerId, manager: customerId ? (mgr.get(customerId) ?? null) : null };
    })
    .filter((r) => me.role !== "staff" || r.manager === me.name);
  if (rows.length) await supabase.from("ads_alert_acks").upsert(rows, { onConflict: "alert_key", ignoreDuplicates: true });
  revalidatePath("/ads/today");
  revalidatePath("/home");
}

// 비즈머니 지금 새로고침: 예전 대시보드가 전 광고주 비즈머니·소진을 지금 시각으로 다시 확인 (약 1~2분) → 화면 캐시 비움
export type RefreshState = { error: string; ok?: string };
export async function refreshBizmoney(_p: RefreshState, _f: FormData): Promise<RefreshState> {
  void _p; void _f;
  const { me, preview, supabase } = await getMe();
  if (!me) return { error: "로그인이 필요합니다." };
  if (preview) return { error: "직원 화면 미리보기 중에는 새로고침할 수 없습니다." };
  const { legacyAdsMode } = await import("@/lib/ads-legacy");
  if (!legacyAdsMode()) {
    // 통합 시스템 수집기를 바로 실행 → 끝날 때까지 실행 기록을 확인 (보통 10~30초)
    const started = new Date(Date.now() - 2000).toISOString();
    const { error } = await supabase.rpc("ads_run_job_with", { p_job: "bizmoney-snapshot", p_body: { force: true } });
    if (error) return { error: `새로고침하지 못했습니다: ${error.message}` };
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data } = await supabase.from("ads_sync_runs").select("ok,summary").eq("job", "hub:bizmoney-snapshot").gte("started_at", started).order("started_at", { ascending: false }).limit(1);
      const run = data?.[0];
      if (run) {
        revalidatePath("/ads");
        revalidatePath("/ads/today");
        revalidatePath("/home");
        return run.ok ? { error: "", ok: "지금 시각 기준으로 다시 확인했습니다." } : { error: `일부만 확인했습니다: ${(run.summary as { error?: string })?.error ?? ""}` };
      }
    }
    return { error: "아직 확인 중입니다. 1~2분 뒤 페이지를 새로고침해 보세요." };
  }
  const token = process.env.DASHBOARD_HUB_TOKEN;
  if (!token) return { error: "예전 대시보드 연결 설정이 없습니다 (Vercel 환경변수)." };
  const base = process.env.DASHBOARD_APP_URL || "https://naver-bizmoney-dashboard.vercel.app";
  try {
    const res = await fetch(`${base}/api/hub?route=hub-bizmoney-refresh`, { method: "POST", headers: { "x-hub-token": token }, cache: "no-store", signal: AbortSignal.timeout(290_000) });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; processedCount?: number; failedCount?: number } | null;
    if (!res.ok || !json?.ok) return { error: `새로고침하지 못했습니다: ${json?.message ?? res.status}` };
    updateTag(ADS_LEGACY_TAG);
    revalidatePath("/ads");
    revalidatePath("/ads/today");
    revalidatePath("/home");
    return { error: "", ok: "지금 시각 기준으로 다시 확인했습니다." };
  } catch {
    return { error: "시간이 오래 걸려 끊겼습니다. 1~2분 뒤 페이지를 새로고침해 보세요 (뒤에서 계속 확인 중일 수 있습니다)." };
  }
}
