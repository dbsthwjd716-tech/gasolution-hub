-- 서진원 인계건: 인계한 네이버 광고주 계정 목록 (대표·팀장이 지정)
--   지금 담당자의 네이버 실적에는 그대로 들어가고, 서진원에게는 '인계건'으로 따로 보임 (총 소진액에는 넣지 않음)
--   급여 '대시보드에서 소진액 불러오기'의 인계 계정 소진액도 이 목록 기준
create table public.handover_accounts (
  customer_id     text primary key,
  advertiser_name text,
  owner_name      text not null default '서진원',
  memo            text,
  created_by      uuid references public.staff(id) default public.my_staff_id(),
  created_at      timestamptz not null default now()
);
comment on table public.handover_accounts is '인계건 계정 (네이버 customer_id). 대표·팀장만 지정·해제';
alter table public.handover_accounts enable row level security;
create policy handover_select on public.handover_accounts for select to authenticated using (public.my_staff_id() is not null);
create policy handover_insert on public.handover_accounts for insert to authenticated with check (public.is_manager());
create policy handover_update on public.handover_accounts for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy handover_remove on public.handover_accounts for delete to authenticated using (public.is_manager());
grant select, insert, update, delete on public.handover_accounts to authenticated;
create trigger zz_preview_block before insert or update or delete on public.handover_accounts
  for each statement execute function public.preview_block();
