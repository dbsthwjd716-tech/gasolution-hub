-- 광고 수집 이전 3단계: 통합 시스템이 직접 수집 (비즈머니 아침 확인 · 검색광고 일별 실적 · 메타 광고비)
--   허브 서버 수집기는 수집기 열쇠로만 아래 읽기 함수를 부름 (쓰기는 기존 ads_import / ads_mark_credential)
--   예약: 예전 대시보드 수집 5분 뒤에 같이 돌려 2~3일 나란히 비교 (예전 것은 비교가 끝나면 끔)

create or replace function public.ads_collector_read(p_token text, p_what text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d1 date := nullif(p_args->>'from', '')::date; d2 date := nullif(p_args->>'to', '')::date; snap date;
begin
  if not public.ads_token_ok(p_token) then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_what = 'advertisers' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'customer_id', customer_id, 'manager', manager,
              'mapped_at', mapped_at, 'credential_group', credential_group, 'adcost_source', adcost_source, 'transferred_at', transferred_at) order by id), '[]')
              from public.ads_advertisers);
  elsif p_what = 'transferred' then
    return (select coalesce(jsonb_agg(jsonb_build_object('customer_id', customer_id, 'stat_date', stat_date, 'paid_cost', paid_cost)), '[]')
              from public.ads_transferred_daily where stat_date between d1 and d2);
  elsif p_what = 'snapshot_done' then
    return (select coalesce(jsonb_agg(customer_id), '[]') from public.ads_bizmoney_snapshots where snapshot_date = d1 and status <> 'failed');
  elsif p_what = 'snapshot_targets' then
    select max(snapshot_date) into snap from public.ads_bizmoney_snapshots;
    return jsonb_build_object('snapshot_date', snap, 'rows',
      (select coalesce(jsonb_agg(distinct jsonb_build_object('customer_id', customer_id, 'advertiser_name', advertiser_name)), '[]')
         from public.ads_bizmoney_snapshots where snapshot_date = snap and source = 'naver_api' and gross_total_cost > 0));
  elsif p_what = 'searchad_done' then
    return (select coalesce(jsonb_agg(customer_id || '|' || stat_date), '[]')
              from public.ads_searchad_status where status = 'complete' and stat_date between d1 and d2);
  elsif p_what = 'meta_accounts' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'external_account_id', external_account_id, 'account_name', account_name,
              'currency', currency, 'timezone_name', timezone_name) order by id), '[]')
              from public.ads_meta_accounts where is_active);
  end if;
  raise exception 'unknown read %', p_what;
end $$;

-- 예약 (UTC 기준 · 한국 시간 = +9)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ads-sync-ref',      '40 22 * * *', $c$select public.ads_run_job('sync-ref')$c$);           -- 07:40 기준 표·API 정보 맞추기 (나란히 비교 기간)
    perform cron.schedule('ads-bizmoney-1',    '5 23 * * *',  $c$select public.ads_run_job('bizmoney-snapshot')$c$);  -- 08:05 비즈머니 아침 확인
    perform cron.schedule('ads-meta',          '5 0 * * *',   $c$select public.ads_run_job('meta-sync')$c$);          -- 09:05 메타 광고비 (최근 3일)
    perform cron.schedule('ads-bizmoney-2',    '35 0 * * *',  $c$select public.ads_run_job('bizmoney-snapshot')$c$);  -- 09:35 못 끝낸 곳 이어서
    perform cron.schedule('ads-searchad-1',    '5 1 * * *',   $c$select public.ads_run_job('searchad-daily')$c$);     -- 10:05 검색광고 일별 실적
    perform cron.schedule('ads-searchad-2',    '5 3 * * *',   $c$select public.ads_run_job('searchad-daily')$c$);     -- 12:05 남은 것 이어서
  end if;
end $$;
