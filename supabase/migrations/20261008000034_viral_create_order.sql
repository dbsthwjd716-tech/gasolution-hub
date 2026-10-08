-- 바이럴 새 건 등록을 한 번에: 건과 상품 줄을 같은 처리 안에서 저장 (상품 줄이 실패하면 건도 남지 않음)
--   부르는 사람 권한 그대로(보안 규칙·공급가 보호 그대로 적용)
create or replace function public.viral_create_order(p_order jsonb, p_items jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare oid uuid;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception '상품을 한 줄 이상 입력해 주세요'; end if;
  insert into public.viral_orders (client_id, brand_id, partner_id, paid_date, memo, staff_id, derived_staff_id)
  values ((p_order->>'client_id')::uuid, nullif(p_order->>'brand_id', '')::uuid, (p_order->>'partner_id')::uuid,
          nullif(p_order->>'paid_date', '')::date, nullif(p_order->>'memo', ''),
          nullif(p_order->>'staff_id', '')::uuid, nullif(p_order->>'derived_staff_id', '')::uuid)
  returning id into oid;
  insert into public.viral_order_items (order_id, sort_order, description, start_date, end_date, cost_amount, sale_amount,
                                        incentive_excluded, product_type, platform, product_name, days, quantity)
  select oid, coalesce(x.sort_order, 0), x.description, x.start_date, x.end_date, coalesce(x.cost_amount, 0), coalesce(x.sale_amount, 0),
         coalesce(x.incentive_excluded, false), x.product_type, x.platform, x.product_name, x.days, x.quantity
    from jsonb_to_recordset(p_items) as x(sort_order int, description text, start_date date, end_date date, cost_amount bigint, sale_amount bigint,
                                          incentive_excluded boolean, product_type text, platform text, product_name text, days int, quantity numeric);
  return oid;
end $$;
revoke all on function public.viral_create_order(jsonb, jsonb) from public, anon;
grant execute on function public.viral_create_order(jsonb, jsonb) to authenticated;
