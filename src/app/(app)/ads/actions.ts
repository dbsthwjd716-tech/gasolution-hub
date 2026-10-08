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
