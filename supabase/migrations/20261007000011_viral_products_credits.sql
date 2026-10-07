-- 바이럴 상품 구조 · 협력사 단가표 · 환불/미소진 잔액 · 견적서 연결
--   * 상품 줄마다 종류(슬롯·가구매…), 적용 매체(네이버·쿠팡·인스타·기타), 일수(슬롯 10/20/30일 또는 직접), 수량
--   * 협력사 단가표: 협력사·상품·매체·일수별 1개당 공급가(VAT 포함)·판매가(VAT 별도) → 입력 화면에서 자동 계산
--   * 잔액 장부(viral_credits): 업체별로
--       환불: 발생(+) → 환급 지급(-) 또는 다음 건에서 차감(-)  ⇒ 남은 환불 잔액
--       미소진: 판매가보다 더 받아 둔 금액 발생(+) → 서비스 작업 등에 사용(-)  ⇒ 남은 미소진 잔액
--     금액은 판매가와 같은 VAT 별도 기준

-- ---------------------------------------------------------------- 상품 줄 구조
alter table public.viral_order_items
  add column product_type text check (product_type in
    ('슬롯','가구매','가구매 제품비','가구매 택배 대행비','블로그 배포','카페침투','플레이스 트래픽','기타')),
  add column platform     text,          -- 적용 매체: 네이버, 쿠팡, 인스타 또는 직접 입력
  add column product_name text,          -- 협력사 상품명 (예: 메이크, 자몽, 우상향)
  add column days         integer check (days is null or days > 0),
  add column quantity     numeric(12,2) check (quantity is null or quantity >= 0);
comment on column public.viral_order_items.product_type is '상품 종류 (슬롯, 가구매, 가구매 제품비, 가구매 택배 대행비, 블로그 배포, 카페침투, 플레이스 트래픽, 기타)';
comment on column public.viral_order_items.platform is '바이럴 적용 매체 (네이버·쿠팡·인스타·직접 입력)';

-- 제품비 종류도 자동으로 인센티브 제외
create or replace function public.viral_items_default_excluded() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(new.description, '') ~ '제품비' or new.product_type = '가구매 제품비' then
    new.incentive_excluded := true;
  end if;
  return new;
end
$$;

-- 이미 옮긴 줄: 내용 글자로 종류·일수·수량·매체를 추정해서 채움 (모르는 건 비워 둠)
update public.viral_order_items set product_type = case
    when description ~ '제품비' then '가구매 제품비'
    when description ~ '택배' then '가구매 택배 대행비'
    when description ~ '가구매' then '가구매'
    when description ~ '슬롯' then '슬롯'
    when description ~ '카페' then '카페침투'
    when description ~ '(블로그|배포|최적화|준최)' then '블로그 배포'
    when description ~ '(트래픽|플레이스)' then '플레이스 트래픽'
    else null end
  where product_type is null and description is not null;
update public.viral_order_items set days = (substring(description from '\((\d{1,3})일\)'))::int
  where days is null and description ~ '\(\d{1,3}일\)';
update public.viral_order_items set quantity = (substring(description from '(\d{1,4})\s*슬롯'))::numeric
  where quantity is null and product_type = '슬롯' and description ~ '\d{1,4}\s*슬롯';
update public.viral_order_items set platform = case
    when description ~ '쿠팡' then '쿠팡'
    when description ~ '(인스타|인스타그램)' then '인스타'
    when description ~ '(네이버|플레이스|블로그|카페)' then '네이버'
    else null end
  where platform is null and description is not null;

-- ---------------------------------------------------------------- 협력사 단가표
create table public.viral_price_list (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references public.viral_partners(id),
  product_type text not null check (product_type in
    ('슬롯','가구매','가구매 제품비','가구매 택배 대행비','블로그 배포','카페침투','플레이스 트래픽','기타')),
  platform     text,                     -- 비우면 모든 매체
  product_name text,                     -- 협력사 상품명 (예: 메이크). 비우면 공통
  days         integer check (days is null or days > 0),   -- 슬롯 일수 (10/20/30). 비우면 일수 무관
  unit_label   text not null default '개',                  -- 슬롯 · 건 · 개
  cost_price   bigint not null default 0 check (cost_price >= 0),   -- 1개당 공급가 (VAT 포함)
  sale_price   bigint not null default 0 check (sale_price >= 0),   -- 1개당 판매가 (VAT 별도)
  memo         text,
  is_active    boolean not null default true,
  updated_by   uuid references public.staff(id),
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
comment on table public.viral_price_list is '협력사별 상품 단가 (1개당 공급가 VAT 포함 / 판매가 VAT 별도)';
create unique index viral_price_list_key on public.viral_price_list
  (partner_id, product_type, coalesce(platform, ''), coalesce(product_name, ''), coalesce(days, 0));
create index viral_price_list_partner_idx on public.viral_price_list(partner_id);
create index viral_price_list_updated_by_idx on public.viral_price_list(updated_by);

create or replace function public.viral_price_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(public.my_staff_id(), new.updated_by);
  return new;
end
$$;
create trigger viral_price_touch before insert or update on public.viral_price_list
  for each row execute function public.viral_price_touch();
create trigger viral_price_log after insert or update or delete on public.viral_price_list
  for each row execute function public.log_change();
revoke execute on function public.viral_price_touch() from public, anon, authenticated;

-- ---------------------------------------------------------------- 환불 · 미소진 잔액 장부
create table public.viral_credits (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id),
  order_id       uuid references public.viral_orders(id) on delete set null,   -- 발생하거나 사용한 바이럴 건
  item_id        uuid references public.viral_order_items(id) on delete set null,
  kind           text not null check (kind in ('refund','prepaid')),
  entry          text not null check (entry in (
                   'refund_issued',   -- 환불 발생 (+)
                   'refund_paid',     -- 고객에게 환급 지급 (-)
                   'refund_applied',  -- 다음 바이럴에서 덜 받음 (-)
                   'prepaid_received',-- 판매가보다 더 받아 둔 금액 (+)
                   'prepaid_used'     -- 서비스 작업 등에 사용 (-)
                 )),
  amount         bigint not null check (amount > 0),        -- VAT 별도, 항상 양수 (방향은 entry로)
  partner_refund bigint not null default 0 check (partner_refund >= 0), -- 환불 시 협력사에서 돌려받는 금액 (VAT 포함)
  occurred_on    date not null default ((now() at time zone 'Asia/Seoul')::date),
  memo           text,
  staff_id       uuid references public.staff(id),
  created_by     uuid references public.staff(id),
  created_at     timestamptz not null default now(),
  check ((kind = 'refund') = (entry like 'refund_%'))
);
comment on table public.viral_credits is '업체별 환불 잔액·미소진 잔액 장부 (VAT 별도)';
create index viral_credits_client_idx on public.viral_credits(client_id, occurred_on);
create index viral_credits_order_idx on public.viral_credits(order_id);
create index viral_credits_item_idx on public.viral_credits(item_id);
create index viral_credits_staff_idx on public.viral_credits(staff_id);
create index viral_credits_created_by_idx on public.viral_credits(created_by);

create or replace function public.viral_credits_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.order_id is not null and (select client_id from public.viral_orders where id = new.order_id) is distinct from new.client_id then
    raise exception '선택한 바이럴 건이 이 거래처의 건이 아닙니다';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(public.my_staff_id(), new.created_by);
    new.staff_id := coalesce(new.staff_id, (select staff_id from public.viral_orders where id = new.order_id), public.my_staff_id());
  end if;
  return new;
end
$$;
create trigger viral_credits_before_write before insert or update on public.viral_credits
  for each row execute function public.viral_credits_before_write();
create trigger viral_credits_log after insert or update or delete on public.viral_credits
  for each row execute function public.log_change();
revoke execute on function public.viral_credits_before_write() from public, anon, authenticated;

-- 업체별 잔액
create view public.viral_credit_balances with (security_invoker = true) as
select c.id as client_id, c.company_name,
       coalesce(sum(case when v.entry = 'refund_issued' then v.amount
                         when v.kind = 'refund' then -v.amount end), 0) as refund_balance,
       coalesce(sum(case when v.entry = 'prepaid_received' then v.amount
                         when v.kind = 'prepaid' then -v.amount end), 0) as prepaid_balance,
       max(v.occurred_on) as last_on
  from public.viral_credits v
  join public.clients c on c.id = v.client_id
 group by c.id, c.company_name;

-- ---------------------------------------------------------------- 견적서 연결
alter table public.viral_orders add column billing_document_id uuid references public.billing_documents(id) on delete set null;
create index viral_orders_billing_idx on public.viral_orders(billing_document_id);

-- ---------------------------------------------------------------- 보안 규칙
alter table public.viral_price_list enable row level security;
alter table public.viral_credits enable row level security;
revoke all on public.viral_price_list, public.viral_credits, public.viral_credit_balances from anon;
grant select, insert, update, delete on public.viral_price_list, public.viral_credits to authenticated;
grant select on public.viral_credit_balances to authenticated;

create policy price_select on public.viral_price_list for select to authenticated using (public.my_staff_id() is not null);
create policy price_write on public.viral_price_list for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy credits_select on public.viral_credits for select to authenticated using (public.my_staff_id() is not null);
create policy credits_insert on public.viral_credits for insert to authenticated
  with check (public.my_staff_id() is not null
              and (order_id is null or public.can_edit_viral_order(order_id) or public.is_manager()));
create policy credits_update on public.viral_credits for update to authenticated
  using (public.is_manager() or created_by = public.my_staff_id())
  with check (public.is_manager() or created_by = public.my_staff_id());
create policy credits_delete on public.viral_credits for delete to authenticated
  using (public.is_manager() or created_by = public.my_staff_id());
