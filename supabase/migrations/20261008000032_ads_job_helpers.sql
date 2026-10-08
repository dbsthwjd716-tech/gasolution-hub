-- 수집 작업 주소용: 열쇠 확인, 실행 기록
create or replace function public.ads_job_ok(p_token text) returns boolean
language sql stable security definer set search_path = public as $$ select public.ads_token_ok(p_token) $$;

create or replace function public.ads_log_run(p_token text, p_job text, p_run_date date, p_started timestamptz, p_ok boolean, p_summary jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ads_token_ok(p_token) then raise exception 'unauthorized' using errcode = '42501'; end if;
  insert into public.ads_sync_runs(job, run_date, started_at, finished_at, ok, summary)
  values ('hub:' || p_job, p_run_date, p_started, now(), p_ok, coalesce(p_summary, '{}'::jsonb));
end $$;
