"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/supabase/server";
import { fetchBizmoney } from "@/lib/ads-legacy";

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
