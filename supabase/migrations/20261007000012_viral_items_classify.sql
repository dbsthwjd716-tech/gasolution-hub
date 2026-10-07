-- 새 상품 줄(시트에서 옮긴 줄 포함)에 종류·일수·수량·매체가 비어 있으면 내용 글자로 채움
create or replace function public.viral_items_default_excluded() returns trigger
language plpgsql set search_path = public as $$
declare d text := coalesce(new.description, '');
begin
  if new.product_type is null and d <> '' then
    new.product_type := case
      when d ~ '제품비' then '가구매 제품비'
      when d ~ '택배' then '가구매 택배 대행비'
      when d ~ '(가구매|네이버구매)' then '가구매'
      when d ~ '슬롯' then '슬롯'
      when d ~ '카페' then '카페침투'
      when d ~ '(블로그|배포|최적화|준최|최적블)' then '블로그 배포'
      when d ~ '(트래픽|플레이스)' then '플레이스 트래픽'
      when d ~ '(인스타|자동완성|영수증|리뷰)' then '기타'
      else null end;
  end if;
  if new.days is null and d ~ '\(\d{1,3}일\)' then
    new.days := (substring(d from '\((\d{1,3})일\)'))::int;
  end if;
  if new.quantity is null and new.product_type = '슬롯' and d ~ '\d{1,4}\s*슬롯' then
    new.quantity := (substring(d from '(\d{1,4})\s*슬롯'))::numeric;
  end if;
  if new.platform is null and d <> '' then
    new.platform := case
      when d ~ '쿠팡' then '쿠팡'
      when d ~ '인스타' then '인스타'
      when new.product_type in ('슬롯','가구매','가구매 제품비','블로그 배포','플레이스 트래픽','카페침투') or d ~ '네이버' then '네이버'
      else null end;
  end if;
  if d ~ '제품비' or new.product_type = '가구매 제품비' then
    new.incentive_excluded := true;
  end if;
  return new;
end
$$;
