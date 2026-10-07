-- 바이럴: 환불·취소(마이너스 금액)와 입금 전 건을 받을 수 있게
--   * 판매가·공급가는 마이너스도 허용 (환불·취소 줄). 판매가 칸 자체는 꼭 있어야 함(서비스 건은 0원)
--   * 입금일은 입금 전이면 비워 둘 수 있음
--   * 목록의 '월'은 입금일 → 없으면 진행 시작일 → 없으면 등록일 기준 (base_date)

alter table public.viral_orders drop constraint viral_orders_sale_amount_check;
alter table public.viral_orders drop constraint viral_orders_cost_amount_check;
alter table public.viral_orders drop constraint viral_orders_partner_paid_amount_check;
alter table public.viral_orders drop constraint viral_orders_partner_invoice_amount_check;
alter table public.viral_orders alter column paid_date drop not null;

comment on column public.viral_orders.paid_date is '고객 입금일. 입금 전이면 비어 있음';
comment on column public.viral_orders.sale_amount is '판매가: 고객에게 안내한 금액(VAT 별도). 환불·취소는 마이너스';

create or replace view public.viral_orders_view with (security_invoker = true) as
select o.*,
       c.company_name, c.business_number, c.representative_name, c.address,
       c.billing_emails, c.is_provisional,
       exists (select 1 from public.client_documents d
               where d.client_id = c.id and d.document_type = 'business_registration') as has_registration,
       p.name as partner_name,
       s.name as staff_name,
       b.name as brand_name,
       coalesce(o.paid_date, o.start_date, (o.created_at at time zone 'Asia/Seoul')::date) as base_date
  from public.viral_orders o
  join public.clients c on c.id = o.client_id
  join public.viral_partners p on p.id = o.partner_id
  left join public.staff s on s.id = o.staff_id
  left join public.brands b on b.id = o.brand_id;

grant select on public.viral_orders_view to authenticated;
revoke all on public.viral_orders_view from anon;
