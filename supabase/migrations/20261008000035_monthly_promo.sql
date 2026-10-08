-- 월간 목표 프로모션 (예전 'GA Solution 프로모션 체커'를 옮김)
--   달마다 팀 목표 · 개인 목표 · 마감액을 넣으면 팀 목표, 개인 목표, 500만원 상승분(유지형/신규)을 판정
--   대표·팀장만 입력·수정 / 직원은 보기만
--   팀장(공지 제외) 줄은 대표·팀장만 볼 수 있음 → 직원 화면과 공지에 팀장 실적이 나오지 않음

create table public.monthly_promo_config (
  id          int primary key default 1 check (id = 1),
  band_size   bigint not null default 5000000 check (band_size > 0),
  band_reward bigint not null default 50000 check (band_reward >= 0),
  team_reward bigint not null default 100000 check (team_reward >= 0),
  partial     boolean not null default false,
  goal_step   bigint not null default 5000000 check (goal_step >= 0),
  trunc_unit  bigint not null default 1000000 check (trunc_unit > 0),
  updated_at  timestamptz not null default now()
);
comment on table public.monthly_promo_config is '월간 프로모션 판정 기준 (한 줄)';
insert into public.monthly_promo_config (id) values (1);

create table public.monthly_promo_months (
  month       date primary key check (extract(day from month) = 1),
  team_target bigint check (team_target >= 0),
  team_kind   text check (team_kind in ('sum', 'manual')),
  closed      boolean not null default false,
  memo        text,
  updated_by  uuid references public.staff(id) default public.my_staff_id(),
  updated_at  timestamptz not null default now()
);
comment on table public.monthly_promo_months is '월간 프로모션 달 (팀 목표·마감 확정)';

create table public.monthly_promo_members (
  month       date not null references public.monthly_promo_months(month) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  staff_id    uuid references public.staff(id),
  target      bigint check (target >= 0),
  target_kind text check (target_kind in ('auto', 'carry', 'manual')),
  actual      bigint check (actual >= 0),
  in_team     boolean not null default true,
  team_amount bigint check (team_amount >= 0),
  is_leader   boolean not null default false,
  excluded    boolean not null default false,
  note        text,
  sort_order  int not null default 0,
  primary key (month, name)
);
comment on table public.monthly_promo_members is '월간 프로모션 팀원별 목표·마감 (팀장 줄은 대표·팀장만 봄)';

alter table public.monthly_promo_config enable row level security;
alter table public.monthly_promo_months enable row level security;
alter table public.monthly_promo_members enable row level security;

create policy mp_config_select on public.monthly_promo_config for select to authenticated using (public.my_staff_id() is not null);
create policy mp_config_update on public.monthly_promo_config for update to authenticated using (public.is_manager()) with check (public.is_manager());

create policy mp_months_select on public.monthly_promo_months for select to authenticated using (public.my_staff_id() is not null);
create policy mp_months_insert on public.monthly_promo_months for insert to authenticated with check (public.is_manager());
create policy mp_months_update on public.monthly_promo_months for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy mp_months_remove on public.monthly_promo_months for delete to authenticated using (public.is_manager());

create policy mp_members_select on public.monthly_promo_members for select to authenticated
  using (public.is_manager() or (public.my_staff_id() is not null and not is_leader));
create policy mp_members_insert on public.monthly_promo_members for insert to authenticated with check (public.is_manager());
create policy mp_members_update on public.monthly_promo_members for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy mp_members_remove on public.monthly_promo_members for delete to authenticated using (public.is_manager());

revoke all on public.monthly_promo_config, public.monthly_promo_months, public.monthly_promo_members from anon;
grant select, update on public.monthly_promo_config to authenticated;
grant select, insert, update, delete on public.monthly_promo_months, public.monthly_promo_members to authenticated;

create trigger zz_preview_block before insert or update or delete on public.monthly_promo_config
  for each statement execute function public.preview_block();
create trigger zz_preview_block before insert or update or delete on public.monthly_promo_months
  for each statement execute function public.preview_block();
create trigger zz_preview_block before insert or update or delete on public.monthly_promo_members
  for each statement execute function public.preview_block();
