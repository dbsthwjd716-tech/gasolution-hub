import { adsRpc } from "@/lib/ads-db";
import { REF_TABLES, runImport } from "@/lib/ads-jobs/import";
import { runImportSecrets } from "@/lib/ads-jobs/secrets";
import { runBizmoneySnapshot } from "@/lib/ads-jobs/bizmoney";
import { runSearchAdDaily } from "@/lib/ads-jobs/searchad";
import { runMetaSync } from "@/lib/ads-jobs/meta";
import { todayKST } from "@/lib/billing-calc";

// 광고 수집 작업 주소: 데이터베이스 예약(pg_cron → pg_net)이나 대표·팀장 버튼이 수집기 열쇠와 함께 부름
export const maxDuration = 300;

const JOBS: Record<string, (token: string, body: Record<string, unknown>) => Promise<unknown>> = {
  import: (t) => runImport(t),
  "import-secrets": (t) => runImportSecrets(t),
  // 나란히 비교 기간: 예전 대시보드에서 등록·수정한 광고주·피이관 실적·API 정보를 매일 아침 맞춤 (수집 결과 표는 건드리지 않음)
  "sync-ref": async (t) => ({ tables: await runImport(t, REF_TABLES), secrets: await runImportSecrets(t) }),
  "bizmoney-snapshot": (t, b) => runBizmoneySnapshot(t, { force: b.force === true, customerId: typeof b.customerId === "string" ? b.customerId : undefined }),
  "searchad-daily": (t) => runSearchAdDaily(t),
  "meta-sync": (t, b) => runMetaSync(t, { from: typeof b.from === "string" ? b.from : undefined, to: typeof b.to === "string" ? b.to : undefined }),
};

export async function POST(request: Request, ctx: RouteContext<"/api/ads/jobs/[job]">) {
  const { job } = await ctx.params;
  const token = request.headers.get("x-ads-token") ?? "";
  const run = JOBS[job];
  if (!run) return Response.json({ ok: false, error: "unknown job" }, { status: 404 });
  if (!(await adsRpc<boolean>("ads_job_ok", { p_token: token }).catch(() => false))) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const started = new Date().toISOString();
  try {
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const summary = await run(token, body);
    await adsRpc("ads_log_run", { p_token: token, p_job: job, p_run_date: todayKST(), p_started: started, p_ok: true, p_summary: summary ?? {} });
    return Response.json({ ok: true, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await adsRpc("ads_log_run", { p_token: token, p_job: job, p_run_date: todayKST(), p_started: started, p_ok: false, p_summary: { error: message, ...((e as { summary?: object }).summary ?? {}) } }).catch(() => {});
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
