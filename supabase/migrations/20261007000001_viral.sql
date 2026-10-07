-- 2단계: 바이럴
-- 원칙
--   * 바이럴 건은 반드시 거래처를 가리킴 → 대표자·사업자번호·주소·메일·사업자등록증은 거래처에서 자동으로 가져옴
--   * 마진은 판매가 - 공급가로 자동 계산
--   * 세 가지 진행 상태를 따로 관리: 고객 입금 / 세금계산서 / 협력사 결제
--   * 직원은 모든 건을 보고 등록. 수정은 본인 담당 건, 대표·팀장은 전부. 삭제는 대표만

-- ---------------------------------------------------------------- 협력사
create table public.viral_partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  business_number text check (business_number is null or public.is_valid_business_number(business_number)),
  memo        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.viral_partners is '바이럴 협력사(제이솔, 풀림, 포에스, 애드매니저 등)';

insert into public.viral_partners(name) values ('제이솔'), ('풀림'), ('포에스'), ('애드매니저');

-- ---------------------------------------------------------------- 바이럴 건
create table public.viral_orders (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id),
  brand_id          uuid references public.brands(id),
  partner_id        uuid not null references public.viral_partners(id),
  staff_id          uuid references public.staff(id),          -- 우리 담당 직원

  paid_date         date not null,                              -- 시작날짜(입금날짜)
  start_date        date,
  end_date          date,
  description       text,                                       -- 기간·상품 내용 (예: 플레이스 최적화, 블로그리뷰 50건)

  cost_amount       bigint not null default 0 check (cost_amount >= 0),   -- 공급가: 협력사 견적(VAT 포함)
  sale_amount       bigint not null check (sale_amount >= 0),             -- 판매가: 고객에게 안내한 금액
  margin_amount     bigint generated always as (sale_amount - cost_amount) stored,

  -- 고객 입금
  payment_received  boolean not null default false,
  payment_note      text,
  -- 세금계산서 (고객에게 발행)
  invoice_status    text not null default 'not_issued'
                    check (invoice_status in ('not_issued','requested','issued','not_needed')),
  invoice_issued_at date,
  -- 협력사 결제
  partner_paid      boolean not null default false,
  partner_paid_amount    bigint check (partner_paid_amount is null or partner_paid_amount >= 0),
  partner_invoice_amount bigint check (partner_invoice_amount is null or partner_invoice_amount >= 0),

  memo              text,

  -- 구글 시트에서 옮겨 온 건: 어느 탭 몇 번째 줄이었는지 (다시 옮겨도 중복 생기지 않도록)
  source_sheet      text,
  source_row        integer,

  created_by        uuid references public.staff(id),
  updated_by        uuid references public.staff(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (end_date is null or start_date is null or end_date >= start_date),
  unique (source_sheet, source_row)
);
create index viral_orders_client_idx on public.viral_orders(client_id);
create index viral_orders_paid_date_idx on public.viral_orders(paid_date);
create index viral_orders_staff_idx on public.viral_orders(staff_id);

-- 브랜드는 반드시 같은 거래처의 브랜드여야 함
create or replace function public.viral_orders_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.brand_id is not null and public.client_of_brand(new.brand_id) is distinct from new.client_id then
    raise exception '선택한 브랜드가 이 거래처의 브랜드가 아닙니다';
  end if;
  if new.invoice_status = 'issued' and new.invoice_issued_at is null then
    new.invoice_issued_at := current_date;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(public.my_staff_id(), new.updated_by);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(public.my_staff_id(), new.created_by);
    if new.staff_id is null then new.staff_id := public.my_staff_id(); end if;
  end if;
  return new;
end
$$;
create trigger viral_orders_before_write before insert or update on public.viral_orders
  for each row execute function public.viral_orders_before_write();

-- 바이럴 건을 등록하면 거래처에 '바이럴' 표시를 자동으로 붙임
create or replace function public.viral_orders_mark_client() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.clients set kinds = array_append(kinds, 'viral')
   where id = new.client_id and not ('viral' = any(kinds));
  return new;
end
$$;
create trigger viral_orders_mark_client after insert on public.viral_orders
  for each row execute function public.viral_orders_mark_client();

create trigger viral_orders_log after insert or update or delete on public.viral_orders
  for each row execute function public.log_change();

create or replace function public.can_edit_viral(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (sid is not null and sid = public.my_staff_id())
$$;

-- ---------------------------------------------------------------- 보기: 업체 정보를 거래처에서 가져와 붙인 목록
create view public.viral_orders_view with (security_invoker = true) as
select o.*,
       c.company_name, c.business_number, c.representative_name, c.address,
       c.billing_emails, c.is_provisional,
       exists (select 1 from public.client_documents d
               where d.client_id = c.id and d.document_type = 'business_registration') as has_registration,
       p.name as partner_name,
       s.name as staff_name,
       b.name as brand_name
  from public.viral_orders o
  join public.clients c on c.id = o.client_id
  join public.viral_partners p on p.id = o.partner_id
  left join public.staff s on s.id = o.staff_id
  left join public.brands b on b.id = o.brand_id;

-- ---------------------------------------------------------------- 보안 규칙
alter table public.viral_partners enable row level security;
alter table public.viral_orders enable row level security;
revoke all on public.viral_partners, public.viral_orders, public.viral_orders_view from anon;

create policy partners_select on public.viral_partners for select to authenticated using (public.my_staff_id() is not null);
create policy partners_write on public.viral_partners for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy viral_select on public.viral_orders for select to authenticated using (public.my_staff_id() is not null);
create policy viral_insert on public.viral_orders for insert to authenticated with check (public.my_staff_id() is not null);
create policy viral_update on public.viral_orders for update to authenticated
  using (public.can_edit_viral(staff_id)) with check (public.can_edit_viral(staff_id));
create policy viral_delete on public.viral_orders for delete to authenticated using (public.is_ceo());

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
