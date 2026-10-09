-- 비즈머니 아침 확인: 전월 광고비를 네이버가 바빠 못 받은 곳(error 표시)은 '오늘 끝남'에서 빼서 다음 실행이 다시 확인
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
    return (select coalesce(jsonb_agg(customer_id), '[]') from public.ads_bizmoney_snapshots where snapshot_date = d1 and status <> 'failed' and error is null);
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
