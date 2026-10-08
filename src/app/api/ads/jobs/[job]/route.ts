import { adsRpc } from "@/lib/ads-db";
import { runImport } from "@/lib/ads-jobs/import";
import { runImportSecrets } from "@/lib/ads-jobs/secrets";
import { todayKST } from "@/lib/billing-calc";

// 광고 수집 작업 주소: 데이터베이스 예약(pg_cron → pg_net)이나 대표·팀장 버튼이 수집기 열쇠와 함께 부름
export const maxDuration = 300;

const JOBS: Record<string, (token: string) => Promise<unknown>> = {
  import: (t) => runImport(t),
  "import-secrets": (t) => runImportSecrets(t),
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
    const summary = await run(token);
    await adsRpc("ads_log_run", { p_token: token, p_job: job, p_run_date: todayKST(), p_started: started, p_ok: true, p_summary: summary ?? {} });
    return Response.json({ ok: true, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await adsRpc("ads_log_run", { p_token: token, p_job: job, p_run_date: todayKST(), p_started: started, p_ok: false, p_summary: { error: message } }).catch(() => {});
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
