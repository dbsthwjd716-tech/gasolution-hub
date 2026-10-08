-- 광고 수집 이전 2단계: 수집용 비밀값을 금고(vault)에
--   env:<이름>  — 담당자별·대행사 네이버 키, 메타 시스템 토큰
--   광고주별 API — 금고에 넣고 ads_api_credentials 에는 금고 id·끝 4자리·상태만
--   꺼내기(ads_collector_secrets)는 수집기 열쇠가 있을 때만
create or replace function public.ads_vault_put(p_name text, p_value text, p_desc text) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = p_name;
  if sid is null then
    sid := vault.create_secret(p_value, p_name, p_desc);
  else
    perform vault.update_secret(sid, p_value);
  end if;
  return sid;
end $$;
revoke all on function public.ads_vault_put(text, text, text) from public, anon, authenticated;

create or replace function public.ads_store_env(p_token text, p_env jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare k text; v text; n integer := 0;
begin
  if not public.ads_token_ok(p_token) then raise exception 'unauthorized' using errcode = '42501'; end if;
  for k, v in select key, value from jsonb_each_text(p_env) loop
    if k !~ '^(NAVER_[A-Z0-9_]*(API_KEY|SECRET_KEY|CUSTOMER_ID)|AGENCY_NAVER_(API_KEY|SECRET_KEY|CUSTOMER_ID)|META_SYSTEM_USER_ACCESS_TOKEN|META_GRAPH_API_VERSION)$' then continue; end if;
    perform public.ads_vault_put('env:' || k, v, '광고 수집용 설정');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.ads_store_credential(p_token text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare aid bigint := (p->>'advertiser_id')::bigint; plat text := p->>'platform'; ks uuid; ss uuid;
begin
  if not public.ads_token_ok(p_token) then raise exception 'unauthorized' using errcode = '42501'; end if;
  if plat not in ('naver_searchad', 'meta') or coalesce(p->>'secret', '') = '' then raise exception '비밀값이 없습니다'; end if;
  if not exists (select 1 from public.ads_advertisers where id = aid) then raise exception '광고주 % 없음', aid; end if;
  if coalesce(p->>'api_key', '') <> '' then ks := public.ads_vault_put(format('cred:%s:%s:key', aid, plat), p->>'api_key', '광고주 API'); end if;
  ss := public.ads_vault_put(format('cred:%s:%s:secret', aid, plat), p->>'secret', '광고주 API');
  perform set_config('app.ads_import', 'on', true);
  insert into public.ads_api_credentials(advertiser_id, platform, account_id, api_key_secret, secret_secret, key_hint, status, status_message, last_verified_at, updated_by, updated_at)
  values (aid, plat, p->>'account_id', ks, ss, p->>'key_hint', coalesce(p->>'status', 'unverified'), p->>'status_message',
          nullif(p->>'last_verified_at', '')::timestamptz, p->>'updated_by', coalesce(nullif(p->>'updated_at', '')::timestamptz, now()))
  on conflict (advertiser_id, platform) do update
    set account_id = excluded.account_id, api_key_secret = coalesce(excluded.api_key_secret, ads_api_credentials.api_key_secret),
        secret_secret = excluded.secret_secret, key_hint = excluded.key_hint, status = excluded.status, status_message = excluded.status_message,
        last_verified_at = excluded.last_verified_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

-- 수집기 실행 중에만: 비밀값 꺼내기
create or replace function public.ads_collector_secrets(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not public.ads_token_ok(p_token) then raise exception 'unauthorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'env', (select coalesce(jsonb_object_agg(substr(name, 5), decrypted_secret), '{}'::jsonb) from vault.decrypted_secrets where name like 'env:%'),
    'credentials', (select coalesce(jsonb_agg(jsonb_build_object(
        'advertiser_id', c.advertiser_id, 'platform', c.platform, 'account_id', c.account_id, 'status', c.status,
        'api_key', (select decrypted_secret from vault.decrypted_secrets where id = c.api_key_secret),
        'secret', (select decrypted_secret from vault.decrypted_secrets where id = c.secret_secret))), '[]'::jsonb)
      from public.ads_api_credentials c));
end $$;

-- 수집기: 광고주 키가 네이버에서 거부되면 상태 '확인 필요'
create or replace function public.ads_mark_credential(p_token text, p_advertiser_id bigint, p_platform text, p_status text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ads_token_ok(p_token) then raise exception 'unauthorized' using errcode = '42501'; end if;
  perform set_config('app.ads_import', 'on', true);
  update public.ads_api_credentials set status = p_status, status_message = left(p_message, 300), last_verified_at = now()
   where advertiser_id = p_advertiser_id and platform = p_platform;
end $$;
