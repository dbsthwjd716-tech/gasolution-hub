-- 광고주 API 값 열람 기록: 대표·팀장이 「보기」를 누를 때마다 남김 (누가·언제·어떤 광고주)
create table public.api_reveal_log (
  id            bigint generated always as identity primary key,
  staff_id      uuid not null references public.staff(id) default public.my_staff_id(),
  advertiser_id bigint not null,
  advertiser_name text,
  platform      text not null check (platform in ('naver_searchad','meta')),
  viewed_at     timestamptz not null default now()
);
comment on table public.api_reveal_log is '광고주 API 값 열람 기록 (예전 대시보드 advertisers.id 기준)';
alter table public.api_reveal_log enable row level security;
create policy api_reveal_select on public.api_reveal_log for select to authenticated using (public.is_manager());
create policy api_reveal_insert on public.api_reveal_log for insert to authenticated with check (public.is_manager() and staff_id = public.my_staff_id());
grant select, insert on public.api_reveal_log to authenticated;
create trigger zz_preview_block before insert or update or delete on public.api_reveal_log for each statement execute function public.preview_block();
