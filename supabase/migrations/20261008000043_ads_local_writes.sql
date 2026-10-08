-- 광고 수집 이전 4단계(전환): 광고주 등록·수정·피이관 업로드·광고주 API를 통합 DB에 바로 저장
--   대표·팀장만. API 비밀값은 금고(vault)에만, 표에는 금고 id와 끝 4자리만
--   (전환 전까지는 화면이 예전 대시보드에 저장하고 매일 아침 sync-ref 로 맞춤 — 전환 때 화면 쪽 스위치만 바꿈)

create or replace function public.ads_need_manager() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception '대표·팀장만 할 수 있습니다' using errcode = '42501'; end if;
end $$;

-- 광고주 등록 화면 목록
create or replace function public.ads_local_accounts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ads_need_manager();
  return jsonb_build_object(
    'advertisers', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'customer_id', a.customer_id, 'gfa_ad_account_no', a.gfa_ad_account_no, 'manager', a.manager,
        'mapped_at', a.mapped_at, 'adcost_source', a.adcost_source, 'transferred_at', a.transferred_at, 'created_at', a.created_at,
        'group_id', g.id, 'group_name', g.name,
        'meta_account', (select m.external_account_id from ads_meta_accounts m where m.advertiser_id = a.id and m.is_active limit 1))
        order by a.created_at desc, a.id desc), '[]')
      from ads_advertisers a left join ads_group_members gm on gm.advertiser_id = a.id left join ads_groups g on g.id = gm.group_id),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from ads_groups where is_active),
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', 0, 'name', s.name,
        'has_credential', exists (select 1 from ads_manager_keys k where trim(k.manager) = trim(s.name) and k.credential_group is not null)) order by s.name), '[]')
      from staff s where s.is_active),
    'transferred', (select jsonb_build_object('through', max(stat_date), 'last_import', max(imported_at), 'rows', count(*)) from ads_transferred_daily));
end $$;

create or replace function public.ads_local_account_create(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_type text := upper(coalesce(p->>'type', ''));
  v_name text := nullif(trim(coalesce(p->>'name', '')), '');
  v_manager text := nullif(trim(coalesce(p->>'manager', '')), '');
  v_cid text := nullif(trim(coalesce(p->>'customer_id', '')), '');
  v_gfa text := nullif(trim(coalesce(p->>'gfa_no', '')), '');
  v_meta text := regexp_replace(lower(trim(coalesce(p->>'meta_id', ''))), '^act_', '');
  v_source text := coalesce(nullif(p->>'adcost_source', ''), 'auto');
  v_transferred date := nullif(p->>'transferred_at', '')::date;
  v_mapped date := coalesce(nullif(p->>'mapped_at', '')::date, (timezone('Asia/Seoul', now()))::date);
  v_group bigint := nullif(p->>'group_id', '')::bigint;
  v_new_group text := nullif(trim(coalesce(p->>'new_group', '')), '');
  v_cred text; v_adv bigint; v_pa bigint;
begin
  perform public.ads_need_manager();
  perform pg_advisory_xact_lock(214091, 3);
  if v_type not in ('SA', 'GFA', 'META') then raise exception '매체를 골라 주세요'; end if;
  if v_name is null then raise exception '광고주명을 입력해 주세요'; end if;
  if not exists (select 1 from staff where trim(name) = v_manager and is_active) then raise exception '담당자를 확인해 주세요'; end if;
  select upper(trim(credential_group)) into v_cred from ads_manager_keys where trim(manager) = v_manager and credential_group is not null limit 1;
  if v_type <> 'META' and (v_cred is null or v_cred = '') then raise exception '% 담당자의 네이버 API 그룹(credential_group) 설정이 없습니다', v_manager; end if;
  if v_source not in ('auto', 'naver_api', 'transferred') then raise exception '실적 기준을 확인해 주세요'; end if;
  if v_source = 'transferred' and v_transferred is null then raise exception '피이관이면 피이관 시작일이 필요합니다'; end if;
  if v_type = 'SA' and (v_cid is null or v_cid !~ '^\d+$') then raise exception 'Customer ID는 숫자로 입력해 주세요'; end if;
  if (v_type = 'GFA' or v_gfa is not null) and (v_gfa is null or v_gfa !~ '^\d+$') then raise exception 'GFA Account ID는 숫자로 입력해 주세요'; end if;
  if v_type = 'META' and v_meta !~ '^\d+$' then raise exception 'Meta 광고계정 ID를 확인해 주세요'; end if;
  if v_cid is not null and exists (select 1 from ads_advertisers where customer_id = v_cid) then raise exception '이미 등록된 Customer ID입니다'; end if;
  if v_gfa is not null and exists (select 1 from ads_advertisers where gfa_ad_account_no = v_gfa::bigint) then raise exception '이미 등록된 GFA Account ID입니다'; end if;
  if v_type = 'META' and (exists (select 1 from ads_meta_accounts where regexp_replace(lower(trim(external_account_id)), '^act_', '') = v_meta)
     or exists (select 1 from ads_perf_accounts where upper(platform) = 'META' and regexp_replace(lower(trim(external_account_id)), '^act_', '') = v_meta)) then
    raise exception '이미 등록된 Meta 광고계정입니다';
  end if;
  if v_new_group is not null then
    if exists (select 1 from ads_groups where lower(trim(name)) = lower(v_new_group)) then raise exception '같은 이름의 그룹이 있습니다. 기존 그룹을 골라 주세요'; end if;
    insert into ads_groups(name, is_active) values (v_new_group, true) returning id into v_group;
  end if;
  if v_group is null or not exists (select 1 from ads_groups where id = v_group and is_active) then raise exception '광고주 그룹을 골라 주세요'; end if;

  if v_type = 'SA' then
    insert into ads_advertisers(name, customer_id, gfa_ad_account_no, manager, credential_group, mapped_at, adcost_source, transferred_at)
    values (v_name, v_cid, v_gfa::bigint, v_manager, v_cred, v_mapped, v_source, case when v_source = 'transferred' then v_transferred end)
    returning id into v_adv;
  elsif v_type = 'GFA' then
    insert into ads_advertisers(name, customer_id, manager, credential_group, mapped_at, adcost_source, gfa_ad_account_no)
    values (v_name, null, v_manager, v_cred, v_mapped, 'auto', v_gfa::bigint) returning id into v_adv;
  else
    insert into ads_advertisers(name, customer_id, manager, adcost_source) values (v_name, null, v_manager, 'auto') returning id into v_adv;
    insert into ads_perf_accounts(platform, external_account_id, account_name, advertiser_id, is_active)
    values ('META', 'act_' || v_meta, v_name, v_adv, true) returning id into v_pa;
    insert into ads_meta_accounts(external_account_id, account_name, perf_account_id, advertiser_id, currency, timezone_name, is_active)
    values ('act_' || v_meta, v_name, v_pa, v_adv, 'KRW', 'Asia/Seoul', true);
    insert into ads_perf_assignments(perf_account_id, manager, valid_from, valid_to, allocation_rate, assignment_type, note)
    values (v_pa, v_manager, coalesce(nullif(p->>'meta_from', '')::date, v_mapped), null, 1, 'PRIMARY', '통합 시스템에서 등록');
  end if;
  insert into ads_group_members(group_id, advertiser_id) values (v_group, v_adv);
  return v_adv;
end $$;

create or replace function public.ads_local_account_update(p_id bigint, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_source text := coalesce(nullif(p->>'adcost_source', ''), 'auto');
  v_transferred date := nullif(p->>'transferred_at', '')::date;
  v_group bigint := nullif(p->>'group_id', '')::bigint;
begin
  perform public.ads_need_manager();
  if not exists (select 1 from ads_advertisers where id = p_id) then raise exception '광고주를 찾을 수 없습니다'; end if;
  if v_source not in ('auto', 'naver_api', 'transferred') then raise exception '실적 기준을 확인해 주세요'; end if;
  if v_source = 'transferred' and v_transferred is null then raise exception '피이관이면 피이관 시작일이 필요합니다'; end if;
  update ads_advertisers
     set adcost_source = v_source,
         transferred_at = case when v_source = 'transferred' then v_transferred else transferred_at end,
         name = coalesce(nullif(trim(coalesce(p->>'name', '')), ''), name)
   where id = p_id;
  if v_group is not null then
    if not exists (select 1 from ads_groups where id = v_group and is_active) then raise exception '광고주 그룹을 확인해 주세요'; end if;
    insert into ads_group_members(group_id, advertiser_id) values (v_group, p_id)
      on conflict (advertiser_id) do update set group_id = excluded.group_id;
  end if;
end $$;

-- 피이관 유상실적 업로드 (같은 계정·날짜는 새 값으로, 파일 안에서 같은 줄이 여러 번이면 마지막 줄)
create or replace function public.ads_local_transferred_import(p_rows jsonb, p_start date, p_end date) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.ads_need_manager();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception '저장할 실적이 없습니다'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception '한 번에 2만 줄까지 올릴 수 있습니다'; end if;
  insert into ads_transferred_daily(customer_id, stat_date, paid_cost, advertiser_name, source_start_date, source_end_date, imported_at)
  select distinct on (r->>'c', r->>'d') r->>'c', (r->>'d')::date, round((r->>'v')::numeric)::bigint, nullif(r->>'n', ''), p_start, p_end, now()
    from jsonb_array_elements(p_rows) with ordinality as t(r, i)
   where (r->>'c') ~ '^\d+$' and (r->>'d') ~ '^\d{4}-\d{2}-\d{2}$'
   order by r->>'c', r->>'d', i desc
  on conflict (customer_id, stat_date) do update
    set paid_cost = excluded.paid_cost, advertiser_name = excluded.advertiser_name,
        source_start_date = excluded.source_start_date, source_end_date = excluded.source_end_date, imported_at = excluded.imported_at;
  get diagnostics n = row_count;
  return n;
end $$;

-- 광고주 API: 목록(끝 4자리·상태만)
create or replace function public.ads_local_credentials() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.ads_need_manager();
  return jsonb_build_object('advertisers', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', coalesce(a.name, ''), 'manager', coalesce(a.manager, ''), 'customerId', coalesce(a.customer_id, ''),
      'metaAccounts', (select coalesce(jsonb_agg(jsonb_build_object('accountId', m.external_account_id, 'accountName', m.account_name)), '[]') from ads_meta_accounts m where m.advertiser_id = a.id),
      'naver', (select jsonb_build_object('accountId', c.account_id, 'keyHint', coalesce(c.key_hint, ''), 'status', c.status, 'statusMessage', coalesce(c.status_message, ''),
                  'lastVerifiedAt', c.last_verified_at, 'updatedBy', c.updated_by) from ads_api_credentials c where c.advertiser_id = a.id and c.platform = 'naver_searchad'),
      'meta', (select jsonb_build_object('accountId', c.account_id, 'keyHint', coalesce(c.key_hint, ''), 'status', c.status, 'statusMessage', coalesce(c.status_message, ''),
                  'lastVerifiedAt', c.last_verified_at, 'updatedBy', c.updated_by) from ads_api_credentials c where c.advertiser_id = a.id and c.platform = 'meta'))
      order by a.name), '[]') from ads_advertisers a));
end $$;

-- 저장된 비밀값 꺼내기: 다시 확인(빈 칸은 기존 값) · 대표·팀장 「보기」 — 허브 서버가 열람 기록을 남긴 뒤에만 부름
create or replace function public.ads_local_credential_secret(p_advertiser bigint, p_platform text) returns jsonb
language plpgsql stable security definer set search_path = public, vault as $$
declare c record;
begin
  perform public.ads_need_manager();
  select * into c from ads_api_credentials where advertiser_id = p_advertiser and platform = p_platform;
  if c.advertiser_id is null then return null; end if;
  return jsonb_build_object('accountId', c.account_id,
    'apiKey', (select decrypted_secret from vault.decrypted_secrets where id = c.api_key_secret),
    'secret', (select decrypted_secret from vault.decrypted_secrets where id = c.secret_secret));
end $$;

-- 확인된 값 저장 (허브 서버가 네이버·Meta에 실제로 접속해 확인한 뒤에만)
create or replace function public.ads_local_credential_save(p_advertiser bigint, p_platform text, p_account_id text, p_api_key text, p_secret text, p_message text, p_actor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare ks uuid; ss uuid; hint text;
begin
  perform public.ads_need_manager();
  if p_platform not in ('naver_searchad', 'meta') or coalesce(p_secret, '') = '' then raise exception '비밀값이 없습니다'; end if;
  if not exists (select 1 from ads_advertisers where id = p_advertiser) then raise exception '광고주를 찾을 수 없습니다'; end if;
  if p_platform = 'naver_searchad' then
    if coalesce(p_api_key, '') = '' then raise exception 'API 라이선스가 없습니다'; end if;
    ks := public.ads_vault_put(format('cred:%s:%s:key', p_advertiser, p_platform), p_api_key, '광고주 API');
    hint := right(p_api_key, 4);
  else
    hint := right(p_secret, 4);
  end if;
  ss := public.ads_vault_put(format('cred:%s:%s:secret', p_advertiser, p_platform), p_secret, '광고주 API');
  insert into ads_api_credentials(advertiser_id, platform, account_id, api_key_secret, secret_secret, key_hint, status, status_message, last_verified_at, updated_by, updated_at)
  values (p_advertiser, p_platform, p_account_id, ks, ss, hint, 'valid', left(p_message, 300), now(), p_actor, now())
  on conflict (advertiser_id, platform) do update
    set account_id = excluded.account_id, api_key_secret = coalesce(excluded.api_key_secret, ads_api_credentials.api_key_secret),
        secret_secret = excluded.secret_secret, key_hint = excluded.key_hint, status = 'valid', status_message = excluded.status_message,
        last_verified_at = now(), updated_by = excluded.updated_by, updated_at = now();
end $$;

create or replace function public.ads_local_credential_mark(p_advertiser bigint, p_platform text, p_status text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ads_need_manager();
  update ads_api_credentials set status = p_status, status_message = left(p_message, 300), last_verified_at = now()
   where advertiser_id = p_advertiser and platform = p_platform;
end $$;

-- 연동 해제: 금고 값은 비우고(이 함수) 표 줄은 화면에서 지움(대표·팀장 지우기 권한) → 이후 공용 키
create or replace function public.ads_local_credential_blank(p_advertiser bigint, p_platform text) returns boolean
language plpgsql security definer set search_path = public, vault as $$
declare c record;
begin
  perform public.ads_need_manager();
  select * into c from ads_api_credentials where advertiser_id = p_advertiser and platform = p_platform;
  if c.advertiser_id is null then return false; end if;
  if c.api_key_secret is not null then perform vault.update_secret(c.api_key_secret, '-'); end if;
  perform vault.update_secret(c.secret_secret, '-');
  return true;
end $$;

create policy ads_api_credentials_remove on public.ads_api_credentials for delete to authenticated using (public.is_manager());
grant delete on public.ads_api_credentials to authenticated;

revoke all on function public.ads_local_accounts(), public.ads_local_account_create(jsonb), public.ads_local_account_update(bigint, jsonb),
  public.ads_local_transferred_import(jsonb, date, date), public.ads_local_credentials(), public.ads_local_credential_secret(bigint, text),
  public.ads_local_credential_save(bigint, text, text, text, text, text, text), public.ads_local_credential_mark(bigint, text, text, text),
  public.ads_local_credential_blank(bigint, text) from public, anon;
grant execute on function public.ads_local_accounts(), public.ads_local_account_create(jsonb), public.ads_local_account_update(bigint, jsonb),
  public.ads_local_transferred_import(jsonb, date, date), public.ads_local_credentials(), public.ads_local_credential_secret(bigint, text),
  public.ads_local_credential_save(bigint, text, text, text, text, text, text), public.ads_local_credential_mark(bigint, text, text, text),
  public.ads_local_credential_blank(bigint, text) to authenticated;
