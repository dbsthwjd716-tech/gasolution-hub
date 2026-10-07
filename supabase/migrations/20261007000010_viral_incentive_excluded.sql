-- 바이럴 상품 줄 중 인센티브에 넣지 않는 줄 (예: 가구매 제품비처럼 고객에게 받아 협력사에 그대로 주는 실비)
alter table public.viral_order_items add column incentive_excluded boolean not null default false;
comment on column public.viral_order_items.incentive_excluded is '인센티브 계산에서 빼는 줄 (제품비 등 실비). 판매가·마진 합계에는 그대로 들어감';

-- 새 줄 내용에 "제품비"가 있으면 자동으로 제외 표시 (나중에 화면에서 풀 수 있음)
create or replace function public.viral_items_default_excluded() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(new.description, '') ~ '제품비' then
    new.incentive_excluded := true;
  end if;
  return new;
end
$$;
create trigger viral_items_default_excluded before insert on public.viral_order_items
  for each row execute function public.viral_items_default_excluded();
revoke execute on function public.viral_items_default_excluded() from public, anon, authenticated;

update public.viral_order_items set incentive_excluded = true where coalesce(description, '') ~ '제품비';
