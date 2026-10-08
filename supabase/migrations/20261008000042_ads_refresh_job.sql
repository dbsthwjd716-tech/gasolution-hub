-- 비즈머니 「지금 새로고침」: 통합 시스템 수집기를 바로 실행 (전체 다시 확인)
--   직원도 누를 수 있음 (비즈머니 확인만). 다른 작업은 대표·팀장만 (ads_run_job 과 같음)
create or replace function public.ads_run_job_with(p_job text, p_body jsonb) returns bigint
language plpgsql security definer set search_path = public, extensions, vault as $$
declare tok text; rid bigint;
begin
  if p_job !~ '^[a-z-]+$' then raise exception '작업 이름이 올바르지 않습니다'; end if;
  if public.my_staff_id() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if public.view_as_id() is not null then raise exception '직원 화면 미리보기 중에는 실행할 수 없습니다' using errcode = '42501'; end if;
  if p_job <> 'bizmoney-snapshot' and not public.is_manager() then raise exception '대표·팀장만 실행할 수 있습니다'; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'ads_collector_token' limit 1;
  select net.http_post(
           url := 'https://gasolution-hub.vercel.app/api/ads/jobs/' || p_job,
           headers := jsonb_build_object('Content-Type', 'application/json', 'x-ads-token', tok),
           body := coalesce(p_body, '{}'::jsonb),
           timeout_milliseconds := 300000)
    into rid;
  return rid;
end $$;
revoke all on function public.ads_run_job_with(text, jsonb) from public, anon;
grant execute on function public.ads_run_job_with(text, jsonb) to authenticated;
