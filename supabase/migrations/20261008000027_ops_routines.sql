-- 오늘의 운영: 광고주별 루틴(평일 매일·매주·매월)과 약속(한 번), 날짜별 완료 기록
--   본인 루틴은 본인이, 대표·팀장은 모두 보고 고칠 수 있음
create table public.ops_routines (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(trim(title)) > 0),
  advertiser_name text,
  client_id       uuid references public.clients(id) on delete set null,
  staff_id        uuid not null references public.staff(id) default public.my_staff_id(),
  kind            text not null check (kind in ('daily','weekly','monthly','once')),
  weekdays        int[] not null default '{}' check (weekdays <@ array[1,2,3,4,5,6,7]),
  month_day       int check (month_day between 1 and 31),
  due_date        date,
  due_time        time,
  start_date      date not null default (timezone('Asia/Seoul', now()))::date,
  memo            text,
  is_active       boolean not null default true,
  created_by      uuid references public.staff(id) default public.my_staff_id(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (kind <> 'weekly' or cardinality(weekdays) > 0),
  check (kind <> 'monthly' or month_day is not null),
  check (kind <> 'once' or due_date is not null)
);
comment on table public.ops_routines is '광고주 루틴·약속. daily=평일 매일, weekly=요일(1=월~7=일), monthly=날짜(말일 넘으면 말일), once=약속 한 번';
create index ops_routines_staff_idx on public.ops_routines(staff_id) where is_active;

create table public.ops_routine_checks (
  routine_id uuid not null references public.ops_routines(id) on delete cascade,
  due_date   date not null,
  done_at    timestamptz not null default now(),
  done_by    uuid references public.staff(id) default public.my_staff_id(),
  note       text,
  primary key (routine_id, due_date)
);
comment on table public.ops_routine_checks is '루틴·약속 완료 기록 (해야 하는 날짜별)';

create or replace function public.can_touch_routine(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or exists (select 1 from public.ops_routines r where r.id = rid and r.staff_id = public.my_staff_id())
$$;
grant execute on function public.can_touch_routine(uuid) to authenticated;

create or replace function public.ops_routines_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger ops_routines_touch before update on public.ops_routines for each row execute function public.ops_routines_touch();

alter table public.ops_routines enable row level security;
alter table public.ops_routine_checks enable row level security;
create policy ops_routines_select on public.ops_routines for select to authenticated using (public.is_manager() or staff_id = public.my_staff_id());
create policy ops_routines_insert on public.ops_routines for insert to authenticated with check (public.is_manager() or staff_id = public.my_staff_id());
create policy ops_routines_update on public.ops_routines for update to authenticated
  using (public.is_manager() or staff_id = public.my_staff_id()) with check (public.is_manager() or staff_id = public.my_staff_id());
create policy ops_routines_remove on public.ops_routines for delete to authenticated using (public.is_manager() or staff_id = public.my_staff_id());
create policy ops_checks_select on public.ops_routine_checks for select to authenticated using (public.can_touch_routine(routine_id));
create policy ops_checks_insert on public.ops_routine_checks for insert to authenticated with check (public.can_touch_routine(routine_id));
create policy ops_checks_remove on public.ops_routine_checks for delete to authenticated using (public.can_touch_routine(routine_id));
grant select, insert, update, delete on public.ops_routines, public.ops_routine_checks to authenticated;

create trigger zz_preview_block before insert or update or delete on public.ops_routines for each statement execute function public.preview_block();
create trigger zz_preview_block before insert or update or delete on public.ops_routine_checks for each statement execute function public.preview_block();
