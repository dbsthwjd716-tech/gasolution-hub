-- 바이럴 공급가·마진은 권한 있는 사람만 (대표·팀장 + '공급가 보기'를 켠 직원)
--   * 공급가·마진·협력사 결제 금액 칸은 일반 직원에게 데이터베이스에서부터 읽기 금지 (화면에서만 숨기는 게 아님)
--   * 권한 있는 사람은 전용 함수로 읽음
--   * 권한 없는 직원은 공급가를 직접 적을 수 없고, 협력사 단가표에 맞는 상품이면 공급가가 자동으로 들어감

alter table public.staff add column can_view_cost boolean not null default false;
comment on column public.staff.can_view_cost is '바이럴 공급가·마진 보기 (대표·팀장은 항상 가능)';
update public.staff set can_view_cost = true where name = '서진원';

create or replace function public.can_view_cost() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
      or coalesce((select can_view_cost from public.staff where auth_user_id = auth.uid() and is_active), false)
$$;
revoke execute on function public.can_view_cost() from public, anon;
grant execute on function public.can_view_cost() to authenticated;

-- 공급가 보기 권한도 대표만 바꿈
create or replace function public.staff_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_ceo()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
          or new.auth_user_id is distinct from old.auth_user_id or new.email is distinct from old.email
          or new.can_view_cost is distinct from old.can_view_cost) then
    raise exception '역할·계정 상태·공급가 보기 권한은 대표만 바꿀 수 있습니다';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------- 읽기: 칸 단위로 막기
revoke select on public.viral_orders from authenticated;
grant select (id, client_id, brand_id, partner_id, staff_id, paid_date, start_date, end_date, description, sale_amount,
              payment_received, payment_note, invoice_status, invoice_issued_at, partner_paid, memo, source_sheet, source_row,
              created_by, updated_by, created_at, updated_at, derived_staff_id, item_count, import_key, billing_document_id)
  on public.viral_orders to authenticated;

revoke select on public.viral_order_items from authenticated;
grant select (id, order_id, sort_order, description, start_date, end_date, sale_amount, source_sheet, source_row,
              created_at, updated_at, incentive_excluded, product_type, platform, product_name, days, quantity)
  on public.viral_order_items to authenticated;

revoke select on public.viral_price_list from authenticated;
grant select (id, partner_id, product_type, platform, product_name, days, unit_label, sale_price, memo, is_active, updated_by, updated_at, created_at)
  on public.viral_price_list to authenticated;

-- 예전 목록 보기(공급가 포함)는 더 이상 쓰지 않음
revoke select on public.viral_orders_view from authenticated;

-- 공급가 없는 목록 보기
create view public.viral_orders_list with (security_invoker = true) as
select o.id, o.client_id, o.brand_id, o.partner_id, o.staff_id, o.paid_date, o.start_date, o.end_date, o.description,
       o.sale_amount, o.payment_received, o.payment_note, o.invoice_status, o.invoice_issued_at, o.partner_paid, o.memo,
       o.source_sheet, o.source_row, o.created_at, o.updated_at, o.derived_staff_id, o.item_count, o.import_key, o.billing_document_id,
       c.company_name, c.business_number, c.representative_name, c.address, c.billing_emails, c.is_provisional,
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
revoke all on public.viral_orders_list from anon;
grant select on public.viral_orders_list to authenticated;

-- 권한 있는 사람이 공급가를 읽는 함수 (권한 없으면 빈 결과)
create or replace function public.viral_order_costs(ids uuid[])
returns table (id uuid, cost_amount bigint, cost_net_amount bigint, margin_amount bigint, partner_paid_amount bigint, partner_invoice_amount bigint)
language sql stable security definer set search_path = public as $$
  select o.id, o.cost_amount, o.cost_net_amount, o.margin_amount, o.partner_paid_amount, o.partner_invoice_amount
    from public.viral_orders o
   where o.id = any(ids) and public.can_view_cost()
$$;
create or replace function public.viral_item_costs(oid uuid)
returns table (id uuid, cost_amount bigint, cost_net_amount bigint, margin_amount bigint)
language sql stable security definer set search_path = public as $$
  select i.id, i.cost_amount, i.cost_net_amount, i.margin_amount
    from public.viral_order_items i
   where i.order_id = oid and public.can_view_cost()
$$;
create or replace function public.viral_price_costs()
returns table (id uuid, cost_price bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.cost_price from public.viral_price_list p where public.can_view_cost()
$$;
revoke execute on function public.viral_order_costs(uuid[]) from public, anon;
revoke execute on function public.viral_item_costs(uuid) from public, anon;
revoke execute on function public.viral_price_costs() from public, anon;
grant execute on function public.viral_order_costs(uuid[]) to authenticated;
grant execute on function public.viral_item_costs(uuid) to authenticated;
grant execute on function public.viral_price_costs() to authenticated;

-- ---------------------------------------------------------------- 쓰기: 권한 없으면 공급가를 못 바꾸고, 단가표로 자동 계산
create or replace function public.viral_item_auto_cost(it public.viral_order_items) returns bigint
language sql stable security definer set search_path = public as $$
  select round(p.cost_price * it.quantity)::bigint
    from public.viral_price_list p
    join public.viral_orders o on o.id = it.order_id and o.partner_id = p.partner_id
   where p.is_active and p.product_type = it.product_type and it.quantity is not null
     and (p.platform is null or p.platform = it.platform)
     and (p.product_name is null or replace(p.product_name, ' ', '') = replace(coalesce(it.product_name, ''), ' ', ''))
     and (p.days is null or p.days = it.days)
   order by (p.days is not null)::int * 4 + (p.product_name is not null)::int * 2 + (p.platform is not null)::int desc
   limit 1
$$;
revoke execute on function public.viral_item_auto_cost(public.viral_order_items) from public, anon, authenticated;

create or replace function public.viral_items_cost_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare auto bigint;
begin
  if public.my_staff_id() is null or public.can_view_cost() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.cost_amount <> 0 then raise exception '공급가는 권한이 있는 사람만 입력할 수 있습니다'; end if;
    new.cost_amount := coalesce(public.viral_item_auto_cost(new), 0);
  else
    if new.cost_amount is distinct from old.cost_amount then
      raise exception '공급가는 권한이 있는 사람만 고칠 수 있습니다';
    end if;
    if (new.product_type, new.platform, new.product_name, new.days, new.quantity)
       is distinct from (old.product_type, old.platform, old.product_name, old.days, old.quantity) then
      auto := public.viral_item_auto_cost(new);
      if auto is not null then new.cost_amount := auto; end if;
    end if;
  end if;
  return new;
end
$$;
create trigger viral_items_cost_guard before insert or update on public.viral_order_items
  for each row execute function public.viral_items_cost_guard();
revoke execute on function public.viral_items_cost_guard() from public, anon, authenticated;

create or replace function public.viral_orders_cost_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.my_staff_id() is null or public.can_view_cost() then
    return new;
  end if;
  -- 공급가 합계는 상품 줄에서 자동 계산되므로 여기서는 협력사 결제 금액만 막음
  if tg_op = 'INSERT' then
    if new.partner_paid_amount is not null or new.partner_invoice_amount is not null then
      raise exception '협력사 결제 금액은 권한이 있는 사람만 입력할 수 있습니다';
    end if;
  elsif (new.partner_paid_amount, new.partner_invoice_amount) is distinct from (old.partner_paid_amount, old.partner_invoice_amount) then
    raise exception '협력사 결제 금액은 권한이 있는 사람만 고칠 수 있습니다';
  end if;
  return new;
end
$$;
create trigger viral_orders_cost_guard before insert or update on public.viral_orders
  for each row execute function public.viral_orders_cost_guard();
revoke execute on function public.viral_orders_cost_guard() from public, anon, authenticated;
