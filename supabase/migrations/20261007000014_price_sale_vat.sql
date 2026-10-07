-- 단가표 판매가가 고객에게 받는 VAT 포함 금액인지 표시 (포함이면 바이럴 입력 시 VAT 별도로 바꿔 저장)
alter table public.viral_price_list add column sale_includes_vat boolean not null default false;
comment on column public.viral_price_list.sale_includes_vat is '판매가가 VAT 포함 금액이면 true (공급가 ÷ 0.7 규칙 가격 등)';
grant select (sale_includes_vat) on public.viral_price_list to authenticated;
