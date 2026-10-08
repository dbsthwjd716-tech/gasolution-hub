-- 광고 수집 이전 4단계: 화면이 통합 DB의 광고 표를 바로 읽음 (예전 대시보드 hub_* 읽기 통로와 같은 결과 모양)
--   재직 직원만 (직원별 담당 범위는 화면에서 거름 — 예전과 같음)
--   GFA 확장프로그램 표는 옮기지 않음 (유상실적에 GFA가 이미 들어 있음)

create or replace function public.ads_need_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_staff_id() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
end $$;

-- 광고주 → 대표 담당자 하나 (같은 Customer ID가 여러 줄이면 id가 가장 작은 것)
create or replace view public.ads_adv_manager with (security_invoker = true) as
select distinct on (a.customer_id) a.customer_id, a.manager, a.id advertiser_id
  from public.ads_advertisers a where a.customer_id is not null and a.manager is not null
 order by a.customer_id, a.id;

-- 비즈머니 현황 · 오늘의 운영 상태
create or replace function public.ads_local_export(p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare snap date; prev date; today date := (timezone('Asia/Seoul', now()))::date;
begin
  perform public.ads_need_staff();
  if p_kind = 'bizmoney' then
    select max(snapshot_date) into snap from ads_bizmoney_snapshots;
    select max(snapshot_date) into prev from ads_bizmoney_snapshots where snapshot_date < snap;
    return jsonb_build_object(
      'snapshot_date', snap, 'previous_date', prev,
      'rows', (select coalesce(jsonb_agg(jsonb_build_object(
          'customer_id', s.customer_id, 'advertiser_name', s.advertiser_name, 'manager', s.manager, 'source', s.source, 'key_source', s.key_source,
          'bizmoney', s.bizmoney, 'gross_total_cost', s.gross_total_cost, 'gross_daily_average', s.gross_daily_average,
          'calculation_days', s.calculation_days, 'period_start', s.period_start, 'period_end', s.period_end, 'expected_days', s.expected_days,
          'status', s.status, 'reason', s.reason, 'error', s.error, 'captured_at', s.captured_at,
          'prev_period_start', s.prev_period_start, 'prev_period_end', s.prev_period_end, 'prev_active', s.prev_active,
          'prev_total_cost', s.prev_total_cost, 'prev_daily_average', s.prev_daily_average,
          'transferred_at', a.transferred_at, 'adcost_source', a.adcost_source, 'gfa_ad_account_no', a.gfa_ad_account_no,
          'client_group', g.name)), '[]')
        from ads_bizmoney_snapshots s
        left join ads_advertisers a on a.customer_id = s.customer_id
        left join ads_group_members m on m.advertiser_id = a.id
        left join ads_groups g on g.id = m.group_id
        where s.snapshot_date = snap),
      'previous', (select coalesce(jsonb_agg(jsonb_build_object('customer_id', customer_id, 'gross_total_cost', gross_total_cost,
          'gross_daily_average', gross_daily_average, 'source', source, 'period_start', period_start)), '[]')
        from ads_bizmoney_snapshots where snapshot_date = prev));
  end if;
  if p_kind = 'ops_status' then
    select max(snapshot_date) into snap from ads_bizmoney_snapshots;
    return jsonb_build_object(
      'today', today,
      -- 통합 시스템 수집 기록만 (이름 앞 hub: 떼고)
      'runs', (select coalesce(jsonb_agg(jsonb_build_object('job', substr(job, 5), 'started_at', started_at, 'finished_at', finished_at, 'ok', ok, 'summary', summary)
                 order by started_at desc), '[]') from ads_sync_runs where run_date = today and job like 'hub:%'),
      'searchad_latest', (select max(stat_date) from ads_searchad_status),
      'searchad_targets', (select count(*) from ads_bizmoney_snapshots where snapshot_date = snap and source = 'naver_api' and gross_total_cost > 0),
      'searchad_done', (select count(*) from ads_bizmoney_snapshots s join ads_searchad_status c
                          on c.customer_id = s.customer_id and c.stat_date = today - 1 and c.status = 'complete'
                         where s.snapshot_date = snap and s.source = 'naver_api' and s.gross_total_cost > 0),
      'meta_accounts', (select coalesce(jsonb_agg(jsonb_build_object('account_name', account_name, 'last_synced_at', last_synced_at)), '[]')
                          from ads_meta_accounts where is_active));
  end if;
  raise exception 'unknown kind %', p_kind;
end $$;

-- 광고비 실적: 네이버 유상실적(광고주별) + 진원 인계 그룹분 + 메타 계정별
create or replace function public.ads_local_perf_spend(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ads_need_staff();
  if p_end < p_start or p_end - p_start > 400 then raise exception 'range too long'; end if;
  return jsonb_build_object(
    'naver_through', (select max(stat_date) from ads_transferred_daily),
    'meta_through', (select max(stat_date) from ads_meta_spend_daily),
    'naver', (
      with grp as (
        select distinct on (gm.advertiser_id) gm.advertiser_id, gm.group_id from ads_group_members gm order by gm.advertiser_id, gm.group_id
      ), daily as (
        select m.manager, t.customer_id cid, t.advertiser_name, t.stat_date, t.paid_cost::bigint cost, g.group_id
          from ads_transferred_daily t
          join ads_adv_manager m on m.customer_id = t.customer_id
          left join grp g on g.advertiser_id = m.advertiser_id
         where t.stat_date between p_start and p_end
      ), classed as (
        select d.*, cg.name group_name,
               (d.manager <> '서진원' and case when h.has_hist then coalesce(h0.flag, false) else coalesce(cg.jinwon_handover, false) end) is_handover
          from daily d
          left join ads_groups cg on cg.id = d.group_id
          left join lateral (
            select x.new_value as flag from ads_group_handover_history x
             where x.group_id = d.group_id and x.effective_date <= d.stat_date
             order by x.effective_date desc, x.changed_at desc limit 1
          ) h0 on true
          cross join lateral (select exists (select 1 from ads_group_handover_history y where y.group_id = d.group_id) as has_hist) h
      )
      select coalesce(jsonb_agg(jsonb_build_object('manager', manager, 'customer_id', cid, 'advertiser_name', name, 'group', group_name,
               'cost', cost, 'handover_cost', ho) order by cost desc), '[]')
        from (select manager, cid, max(advertiser_name) name, max(group_name) group_name, sum(cost)::bigint cost,
                     sum(cost) filter (where is_handover)::bigint ho
                from classed group by manager, cid) z
       where cost <> 0),
    'meta', (select coalesce(jsonb_agg(jsonb_build_object('manager', manager, 'account_name', account_name, 'advertiser_name', advertiser_name,
               'spend', spend, 'days', days) order by spend desc), '[]')
       from (select manager, account_name, max(advertiser_name) advertiser_name, round(sum(attributed_spend))::bigint spend,
                    count(distinct stat_date) filter (where attributed_spend > 0) days
               from ads_meta_manager_daily where stat_date between p_start and p_end and manager is not null group by 1, 2) y
      where spend <> 0));
end $$;

-- 홈 추이 · 주간 프로모션: 날짜·담당자별 네이버(유상실적)·메타
create or replace function public.ads_local_promo_spend(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ads_need_staff();
  if p_end - p_start > 62 then raise exception 'range too long'; end if;
  return jsonb_build_object(
    'naver_through', (select max(stat_date) from ads_transferred_daily),
    'meta_through', (select max(stat_date) from ads_meta_spend_daily),
    'naver', (select coalesce(jsonb_agg(jsonb_build_object('d', x.stat_date, 'm', x.manager, 'v', x.cost) order by x.stat_date, x.manager), '[]')
      from (select t.stat_date, a.manager, sum(t.paid_cost)::bigint cost
              from ads_transferred_daily t join ads_adv_manager a on a.customer_id = t.customer_id
             where t.stat_date between p_start and p_end group by 1, 2) x),
    'meta', (select coalesce(jsonb_agg(jsonb_build_object('d', y.stat_date, 'm', y.manager, 'v', y.spend) order by y.stat_date, y.manager), '[]')
      from (select stat_date, manager, round(sum(attributed_spend))::bigint spend from ads_meta_manager_daily
             where stat_date between p_start and p_end and manager is not null group by 1, 2) y));
end $$;

-- 오늘의 운영: 어제 검색광고 수익률 vs 그 전 7일
create or replace function public.ads_local_roas_watch() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare y date;
begin
  perform public.ads_need_staff();
  select max(stat_date) into y from ads_searchad_daily;
  return jsonb_build_object(
    'date', y,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'customer_id', a.customer_id, 'advertiser_name', a.name, 'manager', a.manager,
        'y_cost', x.y_cost, 'y_value', x.y_value, 'b_cost', x.b_cost, 'b_value', x.b_value, 'b_days', x.b_days)), '[]')
      from (select d.advertiser_id,
                   sum(d.cost) filter (where d.stat_date = y) y_cost,
                   sum(d.conversion_value) filter (where d.stat_date = y) y_value,
                   sum(d.cost) filter (where d.stat_date < y) b_cost,
                   sum(d.conversion_value) filter (where d.stat_date < y) b_value,
                   count(distinct d.stat_date) filter (where d.stat_date < y) b_days
              from ads_searchad_daily d where d.stat_date between y - 7 and y group by 1) x
      join ads_advertisers a on a.id = x.advertiser_id
     where coalesce(x.y_cost, 0) > 0 or coalesce(x.b_cost, 0) > 0));
end $$;

-- 급여 '대시보드에서 소진액 불러오기': 담당자별 월 네이버(유상실적) · 진원 인계 그룹분 · 메타
create or replace function public.ads_local_month_spend(p_month date)
returns table(employee_name text, naver_spend bigint, handover_spend bigint, handover_new_spend bigint, meta_spend bigint)
language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', p_month)::date; m1 date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  perform public.ads_need_staff();
  return query
  with grp as (
    select distinct on (gm.advertiser_id) gm.advertiser_id, gm.group_id from ads_group_members gm order by gm.advertiser_id, gm.group_id
  ), daily as (
    select m.manager, t.stat_date, t.paid_cost::bigint cost, g.group_id
      from ads_transferred_daily t join ads_adv_manager m on m.customer_id = t.customer_id
      left join grp g on g.advertiser_id = m.advertiser_id
     where t.stat_date >= m0 and t.stat_date < m1
  ), classed as (
    select d.manager, d.cost,
           case when h.has_hist then coalesce(h0.flag, false) else coalesce(cg.jinwon_handover, false) end as is_handover
      from daily d
      left join ads_groups cg on cg.id = d.group_id
      left join lateral (
        select x.new_value as flag from ads_group_handover_history x
         where x.group_id = d.group_id and x.effective_date <= d.stat_date order by x.effective_date desc, x.changed_at desc limit 1
      ) h0 on true
      cross join lateral (select exists (select 1 from ads_group_handover_history y where y.group_id = d.group_id) as has_hist) h
  ), nav as (select manager, sum(cost) total from classed group by 1),
  ho as (select sum(cost) filter (where is_handover and manager <> '서진원') ho from classed),
  met as (select v.manager n, round(sum(v.attributed_spend))::bigint s from ads_meta_manager_daily v
           where v.stat_date >= m0 and v.stat_date < m1 and v.manager is not null group by 1),
  names as (select manager n from nav union select n from met union select '서진원')
  select names.n, coalesce(nav.total, 0)::bigint,
         case when names.n = '서진원' then coalesce(ho.ho, 0) else 0 end::bigint, 0::bigint, coalesce(met.s, 0)::bigint
    from names left join nav on nav.manager = names.n left join met on met.n = names.n cross join ho;
end $$;

revoke all on function public.ads_local_export(text), public.ads_local_perf_spend(date, date), public.ads_local_promo_spend(date, date),
  public.ads_local_roas_watch(), public.ads_local_month_spend(date) from public, anon;
grant execute on function public.ads_local_export(text), public.ads_local_perf_spend(date, date), public.ads_local_promo_spend(date, date),
  public.ads_local_roas_watch(), public.ads_local_month_spend(date) to authenticated;
