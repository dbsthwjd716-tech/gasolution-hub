-- 거래처 ↔ 광고주(네이버·메타 계정) 연결
--   광고주에 사업자번호를 두고, 같은 사업자번호의 거래처와 자동으로 이음 (대표·팀장이 직접 잇고 풀 수도 있음)
--   거래처 화면에서 그 업체의 광고 계정 · 최근 비즈머니 · 이번 달 광고비를 봄

alter table public.ads_advertisers add column if not exists business_number text check (business_number ~ '^\d{10}$');
create index if not exists ads_advertisers_bizno on public.ads_advertisers (business_number);
create index if not exists ads_advertisers_client on public.ads_advertisers (client_id);

-- 같은 사업자번호의 거래처와 잇기 (아직 연결 안 된 광고주만). 몇 곳 이었는지 돌려줌
create or replace function public.ads_autolink_clients() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is not null then perform public.ads_need_manager(); end if;
  update ads_advertisers a set client_id = c.id
    from clients c
   where a.client_id is null and a.business_number is not null and c.business_number = a.business_number;
  get diagnostics n = row_count;
  return n;
end $$;

-- 대표·팀장: 광고주 하나를 거래처에 잇기 / 풀기(p_client null), 사업자번호 고치기
create or replace function public.ads_link_client(p_advertiser bigint, p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ads_need_manager();
  if p_client is not null and not exists (select 1 from clients where id = p_client) then raise exception '거래처를 찾을 수 없습니다'; end if;
  update ads_advertisers set client_id = p_client where id = p_advertiser;
  if not found then raise exception '광고주를 찾을 수 없습니다'; end if;
end $$;

create or replace function public.ads_set_business_number(p_advertiser bigint, p_bizno text) returns void
language plpgsql security definer set search_path = public as $$
declare b text := nullif(regexp_replace(coalesce(p_bizno, ''), '\D', '', 'g'), '');
begin
  perform public.ads_need_manager();
  if b is not null and b !~ '^\d{10}$' then raise exception '사업자번호는 숫자 10자리입니다'; end if;
  update ads_advertisers set business_number = b where id = p_advertiser;
end $$;

-- 거래처 화면: 연결된 광고 계정 + 최근 비즈머니 확인 + 이번 달 유상실적·메타
create or replace function public.ads_client_accounts(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare snap date := (select max(snapshot_date) from ads_bizmoney_snapshots);
        m0 date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
begin
  perform public.ads_need_staff();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'customer_id', a.customer_id, 'manager', a.manager, 'adcost_source', a.adcost_source,
      'meta_account', (select m.external_account_id from ads_meta_accounts m where m.advertiser_id = a.id and m.is_active limit 1),
      'bizmoney', s.bizmoney, 'status', s.status, 'expected_days', s.expected_days, 'snapshot_date', snap,
      'naver_month', (select sum(t.paid_cost) from ads_transferred_daily t where t.customer_id = a.customer_id and t.stat_date >= m0),
      'meta_month', (select round(sum(v.spend)) from ads_meta_spend_daily v join ads_meta_accounts m on m.id = v.meta_account_id
                      where m.advertiser_id = a.id and v.stat_date >= m0))
      order by a.name), '[]')
    from ads_advertisers a
    left join ads_bizmoney_snapshots s on s.snapshot_date = snap and s.customer_id = a.customer_id
   where a.client_id = p_client);
end $$;

revoke all on function public.ads_autolink_clients(), public.ads_link_client(bigint, uuid), public.ads_set_business_number(bigint, text),
  public.ads_client_accounts(uuid) from public, anon;
grant execute on function public.ads_autolink_clients(), public.ads_link_client(bigint, uuid), public.ads_set_business_number(bigint, text),
  public.ads_client_accounts(uuid) to authenticated;

-- 거래처를 새로 등록하거나 사업자번호를 고치면 같은 사업자번호의 광고주(아직 연결 안 된 것)와 자동 연결
create or replace function public.clients_autolink_ads() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_number is not null then
    update ads_advertisers set client_id = new.id where client_id is null and business_number = new.business_number;
  end if;
  return null;
end $$;
create trigger clients_autolink_ads after insert or update of business_number on public.clients
  for each row execute function public.clients_autolink_ads();
