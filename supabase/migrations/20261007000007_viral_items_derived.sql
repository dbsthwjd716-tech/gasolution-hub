-- 바이럴 묶음 + 파생 실적자
--   * 바이럴 1건(viral_orders) = 같은 거래처·같은 입금·같은 협력사로 한 번에 진행한 묶음
--   * 그 안에 상품(슬롯) 여러 줄(viral_order_items). 건의 공급가·판매가·기간은 줄 합계로 자동 계산
--   * 입금·세금계산서·협력사 결제 상태는 건 단위로 한 번만 관리
--   * 파생 실적자(derived_staff_id): 다른 담당의 건에서 파생 실적(예: 서진원 4%)을 받는 사람. 대표·팀장만 지정

-- 시트에서 줄 단위로 옮겼던 기존 건은 묶음 단위로 다시 옮기므로 비움 (직접 입력한 건은 그대로 두고 상품 줄로 변환)
delete from public.viral_orders where source_sheet is not null;

alter table public.viral_orders alter column sale_amount set default 0;
alter table public.viral_orders add column derived_staff_id uuid references public.staff(id);
alter table public.viral_orders add column item_count integer not null default 0;
alter table public.viral_orders add column import_key text unique;
alter table public.viral_orders drop constraint viral_orders_source_sheet_source_row_key;
create index viral_orders_derived_staff_idx on public.viral_orders(derived_staff_id);
comment on column public.viral_orders.derived_staff_id is '파생 실적자: 이 건에서 파생 실적을 받는 사람 (예: 서진원 4%)';
comment on column public.viral_orders.import_key is '시트에서 옮긴 묶음의 고유 키 (다시 옮겨도 같은 건으로 덮어씀)';

create table public.viral_order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.viral_orders(id) on delete cascade,
  sort_order      integer not null default 0,
  description     text,                       -- 상품·슬롯 내용 (예: 우상향 30슬롯 4스타세트)
  start_date      date,
  end_date        date,
  cost_amount     bigint not null default 0,  -- 공급가(VAT 포함)
  sale_amount     bigint not null default 0,  -- 판매가(VAT 별도). 환불은 마이너스
  cost_net_amount bigint generated always as (round(cost_amount / 1.1)::bigint) stored,
  margin_amount   bigint generated always as (sale_amount - round(cost_amount / 1.1)::bigint) stored,
  source_sheet    text,
  source_row      integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  unique (source_sheet, source_row)
);
comment on table public.viral_order_items is '바이럴 건 안의 상품(슬롯) 줄';
create index viral_order_items_order_idx on public.viral_order_items(order_id);

-- 직접 입력했던 기존 건은 상품 1줄짜리 건으로 변환
insert into public.viral_order_items(order_id, description, start_date, end_date, cost_amount, sale_amount)
select id, description, start_date, end_date, cost_amount, sale_amount from public.viral_orders;

-- 상품 줄이 바뀌면 건의 합계·기간·줄 수를 다시 계산
create or replace function public.viral_items_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  update public.viral_orders o set
    sale_amount = coalesce(t.sale, 0),
    cost_amount = coalesce(t.cost, 0),
    item_count  = coalesce(t.n, 0),
    start_date  = t.s,
    end_date    = t.e
  from (select sum(sale_amount) sale, sum(cost_amount) cost, count(*) n, min(start_date) s, max(end_date) e
          from public.viral_order_items where order_id = oid) t
  where o.id = oid;
  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    update public.viral_orders o set
      sale_amount = coalesce(t.sale, 0), cost_amount = coalesce(t.cost, 0), item_count = coalesce(t.n, 0),
      start_date = t.s, end_date = t.e
    from (select sum(sale_amount) sale, sum(cost_amount) cost, count(*) n, min(start_date) s, max(end_date) e
            from public.viral_order_items where order_id = old.order_id) t
    where o.id = old.order_id;
  end if;
  return null;
end
$$;
create trigger viral_items_rollup after insert or update or delete on public.viral_order_items
  for each row execute function public.viral_items_rollup();
create trigger viral_items_touch before update on public.viral_order_items
  for each row execute function public.touch_updated_at();
create trigger viral_items_log after insert or update or delete on public.viral_order_items
  for each row execute function public.log_change();
revoke execute on function public.viral_items_rollup() from public, anon, authenticated;
update public.viral_orders o set item_count = (select count(*) from public.viral_order_items i where i.order_id = o.id);

-- 파생 실적자는 대표·팀장만 지정·변경 (직원이 스스로 실적을 붙이지 못하게)
create or replace function public.viral_orders_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.brand_id is not null and public.client_of_brand(new.brand_id) is distinct from new.client_id then
    raise exception '선택한 브랜드가 이 거래처의 브랜드가 아닙니다';
  end if;
  if public.my_staff_id() is not null and not public.is_manager()
     and new.derived_staff_id is distinct from (case when tg_op = 'UPDATE' then old.derived_staff_id end) then
    raise exception '파생 실적자는 대표·팀장만 지정할 수 있습니다';
  end if;
  if new.invoice_status = 'issued' and new.invoice_issued_at is null then
    new.invoice_issued_at := current_date;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(public.my_staff_id(), new.updated_by);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(public.my_staff_id(), new.created_by);
    if new.staff_id is null and new.import_key is null and new.source_sheet is null then
      new.staff_id := public.my_staff_id();
    end if;
  end if;
  return new;
end
$$;
revoke execute on function public.viral_orders_before_write() from public, anon, authenticated;

-- 상품 줄 권한: 그 건을 고칠 수 있는 사람만
create or replace function public.can_edit_viral_order(oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_edit_viral((select staff_id from public.viral_orders where id = oid))
$$;
revoke execute on function public.can_edit_viral_order(uuid) from public, anon;
grant execute on function public.can_edit_viral_order(uuid) to authenticated;

alter table public.viral_order_items enable row level security;
revoke all on public.viral_order_items from anon;
grant select, insert, update, delete on public.viral_order_items to authenticated;
create policy items_select on public.viral_order_items for select to authenticated using (public.my_staff_id() is not null);
create policy items_insert on public.viral_order_items for insert to authenticated with check (public.can_edit_viral_order(order_id));
create policy items_update on public.viral_order_items for update to authenticated
  using (public.can_edit_viral_order(order_id)) with check (public.can_edit_viral_order(order_id));
create policy items_delete on public.viral_order_items for delete to authenticated using (public.can_edit_viral_order(order_id));

-- 목록용 보기: 파생 실적자·상품 요약 추가
drop view public.viral_orders_view;
create view public.viral_orders_view with (security_invoker = true) as
select o.*,
       c.company_name, c.business_number, c.representative_name, c.address,
       c.billing_emails, c.is_provisional,
       exists (select 1 from public.client_documents d
               where d.client_id = c.id and d.document_type = 'business_registration') as has_registration,
       p.name as partner_name,
       s.name as staff_name,
       b.name as brand_name,
       coalesce(o.paid_date, o.start_date, (o.created_at at time zone 'Asia/Seoul')::date) as base_date,
       ds.name as derived_staff_name,
       (select i.description from public.viral_order_items i where i.order_id = o.id
         order by i.sort_order, i.created_at limit 1) as first_item_description
  from public.viral_orders o
  join public.clients c on c.id = o.client_id
  join public.viral_partners p on p.id = o.partner_id
  left join public.staff s on s.id = o.staff_id
  left join public.staff ds on ds.id = o.derived_staff_id
  left join public.brands b on b.id = o.brand_id;
revoke all on public.viral_orders_view from anon;
grant select on public.viral_orders_view to authenticated;
