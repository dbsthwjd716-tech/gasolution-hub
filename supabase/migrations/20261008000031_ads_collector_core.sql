-- 광고 수집 이전: 수집기 열쇠·가져오기·실행 예약 기반
--   * 수집기 열쇠(ads_collector_token)는 데이터베이스가 직접 만들어 금고(vault)에만 둠 — 사람이 볼 일 없음
--   * 데이터베이스(pg_cron) → pg_net 으로 허브 서버 /api/ads/jobs/<작업> 을 이 열쇠와 함께 호출
--   * 허브 서버는 받은 열쇠로만 아래 ads_* 쓰기 함수를 부를 수 있음 (서버에 비밀 키 저장 없음)
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ads_collector_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ads_collector_token', '광고 수집기 내부 열쇠 (허브 서버 ↔ DB)');
  end if;
end $$;

create or replace function public.ads_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = public, vault as $$
  select p_token is not null and length(p_token) >= 32
     and p_token = (select decrypted_secret from vault.decrypted_secrets where name = 'ads_collector_token' limit 1)
$$;
revoke all on function public.ads_token_ok(text) from public, anon, authenticated;

-- 예전 표 → 통합 표 가져오기 (같은 키면 새 값으로). 허브 열 이름 그대로 넘어옴
create or replace function public.ads_import(p_token text, p_table text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare cols text; pk text; upd text; n integer;
begin
  if not public.ads_token_ok(p_token) then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_table not in ('ads_advertisers','ads_groups','ads_group_members','ads_group_handover_history','ads_manager_keys','ads_perf_accounts',
                     'ads_perf_assignments','ads_meta_accounts','ads_meta_spend_daily','ads_bizmoney_snapshots','ads_sync_runs',
                     'ads_searchad_daily','ads_searchad_status','ads_transferred_daily') then
    raise exception 'unknown table %', p_table;
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  -- 넘어온 줄에 있는 열만 (허브에만 있는 client_id 같은 열은 건드리지 않음)
  select string_agg(quote_ident(a.attname), ',' order by a.attnum) into cols
    from pg_attribute a
   where a.attrelid = ('public.' || p_table)::regclass and a.attnum > 0 and not a.attisdropped
     and (p_rows -> 0) ? a.attname;
  select string_agg(quote_ident(a.attname), ',') into pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = ('public.' || p_table)::regclass and i.indisprimary;
  select string_agg(format('%1$s = excluded.%1$s', c), ',') into upd
    from unnest(string_to_array(cols, ',')) c where c <> all(string_to_array(pk, ','));
  perform set_config('app.ads_import', 'on', true);
  execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%s) do %s',
                 p_table, cols, cols, p_table, pk, case when upd is null then 'nothing' else 'update set ' || upd end)
    using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;

-- 가져오기 끝: 번호 자동 증가를 가장 큰 id 뒤로
create or replace function public.ads_import_finish(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if not public.ads_token_ok(p_token) then raise exception 'unauthorized' using errcode = '42501'; end if;
  foreach t in array array['ads_advertisers','ads_groups','ads_group_handover_history','ads_perf_accounts','ads_perf_assignments','ads_meta_accounts','ads_sync_runs'] loop
    execute format('select setval(pg_get_serial_sequence(%L, ''id''), greatest((select coalesce(max(id), 0) from public.%I), 1))', 'public.' || t, t);
  end loop;
end $$;

-- 작업 실행: 대표·팀장 화면 버튼 또는 예약(pg_cron)이 허브 서버 작업 주소를 열쇠와 함께 호출
create or replace function public.ads_run_job(p_job text) returns bigint
language plpgsql security definer set search_path = public, extensions, vault as $$
declare tok text; rid bigint;
begin
  if p_job !~ '^[a-z-]+$' then raise exception '작업 이름이 올바르지 않습니다'; end if;
  if auth.uid() is not null and not public.is_manager() then raise exception '대표·팀장만 실행할 수 있습니다'; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'ads_collector_token' limit 1;
  select net.http_post(
           url := 'https://gasolution-hub.vercel.app/api/ads/jobs/' || p_job,
           headers := jsonb_build_object('Content-Type', 'application/json', 'x-ads-token', tok),
           body := '{}'::jsonb,
           timeout_milliseconds := 300000)
    into rid;
  return rid;
end $$;
revoke all on function public.ads_run_job(text) from public, anon;
grant execute on function public.ads_run_job(text) to authenticated;
