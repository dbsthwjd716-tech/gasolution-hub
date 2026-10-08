import "server-only";
import { adsRpc, legacyTablePage } from "@/lib/ads-db";

// 예전 대시보드 → 통합 DB 표 복사 (몇 번을 돌려도 같은 결과: 같은 키는 새 값으로)
export const IMPORT_ORDER = [
  "ads_groups",
  "ads_advertisers",
  "ads_group_members",
  "ads_group_handover_history",
  "ads_manager_keys",
  "ads_perf_accounts",
  "ads_perf_assignments",
  "ads_meta_accounts",
  "ads_meta_spend_daily",
  "ads_bizmoney_snapshots",
  "ads_sync_runs",
  "ads_searchad_daily",
  "ads_searchad_status",
  "ads_transferred_daily",
] as const;

// 기준 표만 (수집 결과 표 제외): 나란히 비교 기간에 매일 맞춤
export const REF_TABLES = [
  "ads_groups",
  "ads_advertisers",
  "ads_group_members",
  "ads_group_handover_history",
  "ads_manager_keys",
  "ads_perf_accounts",
  "ads_perf_assignments",
  "ads_meta_accounts",
  "ads_transferred_daily",
] as const;

export async function runImport(token: string, tables: readonly string[] = IMPORT_ORDER) {
  const PAGE = 2000;
  const counts: Record<string, number> = {};
  for (const t of tables) {
    let offset = 0;
    counts[t] = 0;
    for (;;) {
      const rows = await legacyTablePage(t, offset, PAGE);
      if (!rows.length) break;
      counts[t] += await adsRpc<number>("ads_import", { p_token: token, p_table: t, p_rows: rows });
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }
  await adsRpc("ads_import_finish", { p_token: token });
  return counts;
}
