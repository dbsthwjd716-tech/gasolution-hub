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
