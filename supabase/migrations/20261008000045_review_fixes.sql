-- 점검 보완 (10/8)
--   1) 「지금 새로고침」 연타 막기: 같은 작업을 90초 안에 다시 부르면 실행하지 않음
--   2) 직원이 올렸다가 등록에 실패한 본인 서류 파일은 본인이 지울 수 있게 (등록된 서류는 여전히 대표·팀장만)
--   3) 대표가 한 번이라도 로그인했는지 (직원 관리 화면의 '비밀번호 초기화' 표시용, 시각·이메일은 안 내보냄)
--   4) 월간 프로모션: 팀장 줄은 팀 산정에 넣을 수 없음
--   5) 함수 search_path 고정 (보안 점검 경고)

create table if not exists public.ads_job_requests (
  job          text primary key,
  requested_at timestamptz not null default now(),
  requested_by uuid references public.staff(id)
);
alter table public.ads_job_requests enable row level security;
create policy ads_job_requests_select on public.ads_job_requests for select to authenticated using (public.my_staff_id() is not null);
revoke all on public.ads_job_requests from anon;
grant select on public.ads_job_requests to authenticated;
create trigger zz_preview_block before insert or update or delete on public.ads_job_requests
  for each statement execute function public.preview_block();

create or replace function public.ads_run_job_with(p_job text, p_body jsonb) returns bigint
language plpgsql security definer set search_path = public, extensions, vault as $$
declare tok text; rid bigint; last timestamptz;
begin
  if p_job !~ '^[a-z-]+$' then raise exception '작업 이름이 올바르지 않습니다'; end if;
  if public.my_staff_id() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  if public.view_as_id() is not null then raise exception '직원 화면 미리보기 중에는 실행할 수 없습니다' using errcode = '42501'; end if;
  if p_job <> 'bizmoney-snapshot' and not public.is_manager() then raise exception '대표·팀장만 실행할 수 있습니다'; end if;
  perform pg_advisory_xact_lock(214091, 9);
  select requested_at into last from ads_job_requests where job = p_job;
  if last is not null and last > now() - interval '90 seconds' then return null; end if;  -- 방금 누가 실행함 → 그 결과를 기다림
  insert into ads_job_requests(job, requested_at, requested_by) values (p_job, now(), public.my_staff_id())
    on conflict (job) do update set requested_at = excluded.requested_at, requested_by = excluded.requested_by;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'ads_collector_token' limit 1;
  select net.http_post(
           url := 'https://gasolution-hub.vercel.app/api/ads/jobs/' || p_job,
           headers := jsonb_build_object('Content-Type', 'application/json', 'x-ads-token', tok),
           body := coalesce(p_body, '{}'::jsonb),
           timeout_milliseconds := 300000)
    into rid;
  return rid;
end $$;

-- 등록되지 않은 본인 폴더 파일만 본인이 지움
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$create policy staff_docs_files_delete_orphan on storage.objects for delete to authenticated
      using (bucket_id = 'staff-docs' and public.view_as_id() is null
             and (storage.foldername(name))[1] = public.my_staff_id()::text
             and not exists (select 1 from public.staff_documents d where d.storage_path = name))$p$;
  end if;
end $$;

create or replace function public.ceo_has_signed_in() returns boolean
language plpgsql stable security definer set search_path = public, auth as $$
begin
  return exists (select 1 from public.staff c join auth.users u on u.id = c.auth_user_id
                  where c.role = 'ceo' and c.is_active and u.last_sign_in_at is not null);
end $$;
revoke all on function public.ceo_has_signed_in() from public, anon;
grant execute on function public.ceo_has_signed_in() to authenticated;

update public.monthly_promo_members set in_team = false where is_leader and in_team;
alter table public.monthly_promo_members add constraint monthly_promo_leader_not_team check (not (is_leader and in_team));

alter function public.att_importing() set search_path = public;
alter function public.ops_routines_touch() set search_path = public;
