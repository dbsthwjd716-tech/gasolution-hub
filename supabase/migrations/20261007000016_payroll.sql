-- 5단계: 인센티브·급여
--   * 대표·팀장만 보고 다룸 (직원에게는 표 자체가 보이지 않음)
--   * 직원별 급여 설정(직군·기본급·요율) + 구간표(영업 AE·비영업 AE 요율, 직급수당) + 달별 급여
--   * 달별 급여는 입력값(소진액 등)만 저장하고 계산은 화면에서. '마감'하면 그때 계산 결과를 그대로 보관하고 더 못 고침
--   * 실제 금액·요율은 이 파일에 넣지 않음 (데이터베이스에서 직접 입력)

create table public.payroll_profiles (
  staff_id          uuid primary key references public.staff(id),
  track             text not null check (track in ('lead','sales_ae','nonsales_ae')),
  base_pay          bigint not null default 0 check (base_pay >= 0),
  cert_allowance    bigint not null default 0 check (cert_allowance >= 0),
  probation         boolean not null default false,
  rank_allowance    boolean not null default false,
  viral_in_spend    boolean not null default false,
  other_in_spend    boolean not null default false,
  viral_rate        numeric(7,5) not null default 0,
  derived_rate      numeric(7,5) not null default 0,
  closing_rate      numeric(7,5) not null default 0,
  team_rate         numeric(7,5) not null default 0,
  markup_rate       numeric(7,5) not null default 0,
  coupang_rate      numeric(7,5) not null default 0,
  other_media_rate  numeric(7,5) not null default 0,
  is_active         boolean not null default true,
  memo              text,
  updated_by        uuid references public.staff(id),
  updated_at        timestamptz not null default now()
);
comment on table public.payroll_profiles is '직원별 급여 설정. 대표·팀장만';

create table public.payroll_tiers (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('sales_ae','nonsales_ae','rank')),
  min_spend  bigint not null check (min_spend >= 0),
  rate       numeric(7,5),
  rank_name  text,
  amount     bigint,
  unique (kind, min_spend),
  check ((kind = 'rank' and rank_name is not null and amount is not null) or (kind <> 'rank' and rate is not null))
);
comment on table public.payroll_tiers is '마감 소진액 구간: 영업 AE·비영업 AE 인센티브 요율, 직급수당';

create table public.payroll_months (
  month       date primary key check (extract(day from month) = 1),
  team_goal   bigint not null default 0,
  team_bonus  bigint not null default 100000,
  status      text not null default 'draft' check (status in ('draft','closed')),
  closed_at   timestamptz,
  closed_by   uuid references public.staff(id),
  memo        text,
  created_at  timestamptz not null default now()
);
comment on table public.payroll_months is '급여 달 (실적 기준 달). 마감하면 그 달 급여는 고칠 수 없음';

create table public.payroll_entries (
  id          uuid primary key default gen_random_uuid(),
  month       date not null references public.payroll_months(month) on delete cascade,
  staff_id    uuid not null references public.staff(id),
  inputs      jsonb not null default '{}'::jsonb,
  extras      jsonb not null default '[]'::jsonb,
  snapshot    jsonb,                 -- 마감 시 계산 결과 (줄별 금액·기준값)
  total       bigint,                -- 마감 시 지급 예정액
  memo        text,
  updated_by  uuid references public.staff(id),
  updated_at  timestamptz not null default now(),
  unique (month, staff_id)
);
create index payroll_entries_staff_idx on public.payroll_entries(staff_id);

-- 마감된 달은 대표·팀장도 입력값을 못 바꿈 (먼저 마감 해제)
create or replace function public.payroll_entries_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from public.payroll_months where month = coalesce(new.month, old.month);
  if st = 'closed' and not coalesce(current_setting('payroll.closing', true), '') = 'on' then
    raise exception '마감된 달의 급여는 고칠 수 없습니다. 먼저 마감을 풀어 주세요';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_by := coalesce(public.my_staff_id(), new.updated_by);
  new.updated_at := now();
  return new;
end
$$;
create trigger payroll_entries_guard before insert or update or delete on public.payroll_entries
  for each row execute function public.payroll_entries_guard();
revoke execute on function public.payroll_entries_guard() from public, anon, authenticated;

create or replace function public.payroll_profiles_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := coalesce(public.my_staff_id(), new.updated_by);
  new.updated_at := now();
  return new;
end
$$;
create trigger payroll_profiles_touch before insert or update on public.payroll_profiles
  for each row execute function public.payroll_profiles_touch();
revoke execute on function public.payroll_profiles_touch() from public, anon, authenticated;

-- 마감: 화면에서 계산한 결과를 한 번에 보관하고 달을 잠금 / 마감 해제: 대표만
create or replace function public.payroll_close(m date, results jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0;
begin
  if not public.is_manager() then raise exception '대표·팀장만 마감할 수 있습니다'; end if;
  if (select status from public.payroll_months where month = m) is distinct from 'draft' then
    raise exception '마감할 수 없는 달입니다';
  end if;
  perform set_config('payroll.closing', 'on', true);
  for r in select * from jsonb_array_elements(results) loop
    update public.payroll_entries
       set snapshot = r->'snapshot', total = (r->>'total')::bigint
     where month = m and staff_id = (r->>'staff_id')::uuid;
    n := n + 1;
  end loop;
  update public.payroll_months set status = 'closed', closed_at = now(), closed_by = public.my_staff_id() where month = m;
  perform set_config('payroll.closing', '', true);
  return n;
end
$$;
create or replace function public.payroll_reopen(m date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ceo() then raise exception '마감 해제는 대표만 할 수 있습니다'; end if;
  update public.payroll_months set status = 'draft', closed_at = null, closed_by = null where month = m;
end
$$;
revoke execute on function public.payroll_close(date, jsonb) from public, anon;
revoke execute on function public.payroll_reopen(date) from public, anon;
grant execute on function public.payroll_close(date, jsonb) to authenticated;
grant execute on function public.payroll_reopen(date) to authenticated;

-- 달 상태(마감)는 함수로만 바꿈: 직접 status를 바꾸지 못하게
create or replace function public.payroll_months_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and coalesce(current_setting('payroll.closing', true), '') <> 'on'
     and not (new.status = 'draft' and public.is_ceo()) then
    raise exception '마감은 마감 버튼으로만 할 수 있습니다';
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' and new.status = 'closed'
     and (new.team_goal, new.team_bonus) is distinct from (old.team_goal, old.team_bonus) then
    raise exception '마감된 달의 팀 목표는 고칠 수 없습니다';
  end if;
  if tg_op = 'INSERT' and new.status <> 'draft' then
    raise exception '새 달은 작성 중으로만 만들 수 있습니다';
  end if;
  return new;
end
$$;
create trigger payroll_months_guard before insert or update on public.payroll_months
  for each row execute function public.payroll_months_guard();
revoke execute on function public.payroll_months_guard() from public, anon, authenticated;

-- 그 달 바이럴 판매가(VAT 별도, 인센티브 제외 상품 빼고): 담당자별·파생 실적자별
create or replace function public.payroll_viral(m date)
returns table (staff_id uuid, own_sales bigint, derived_sales bigint)
language sql stable security definer set search_path = public as $$
  with lines as (
    select o.staff_id, o.derived_staff_id, i.sale_amount
      from public.viral_orders o
      join public.viral_order_items i on i.order_id = o.id
     where public.is_manager()
       and o.paid_date >= m and o.paid_date < (m + interval '1 month')::date
       and not i.incentive_excluded
  )
  select s.id,
         coalesce((select sum(sale_amount) from lines where lines.staff_id = s.id), 0)::bigint,
         coalesce((select sum(sale_amount) from lines where lines.derived_staff_id = s.id), 0)::bigint
    from public.staff s
   where public.is_manager()
$$;
revoke execute on function public.payroll_viral(date) from public, anon;
grant execute on function public.payroll_viral(date) to authenticated;

-- ---------------------------------------------------------------- 권한: 대표·팀장만
alter table public.payroll_profiles enable row level security;
alter table public.payroll_tiers enable row level security;
alter table public.payroll_months enable row level security;
alter table public.payroll_entries enable row level security;

create policy payroll_profiles_all on public.payroll_profiles for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy payroll_tiers_select on public.payroll_tiers for select to authenticated using (public.is_manager());
create policy payroll_tiers_write on public.payroll_tiers for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy payroll_months_select on public.payroll_months for select to authenticated using (public.is_manager());
create policy payroll_months_insert on public.payroll_months for insert to authenticated with check (public.is_manager());
create policy payroll_months_update on public.payroll_months for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy payroll_months_delete on public.payroll_months for delete to authenticated using (public.is_ceo() and status = 'draft');
create policy payroll_entries_all on public.payroll_entries for all to authenticated using (public.is_manager()) with check (public.is_manager());

revoke all on public.payroll_profiles, public.payroll_tiers, public.payroll_months, public.payroll_entries from anon;
grant select, insert, update, delete on public.payroll_profiles, public.payroll_tiers, public.payroll_months, public.payroll_entries to authenticated;
