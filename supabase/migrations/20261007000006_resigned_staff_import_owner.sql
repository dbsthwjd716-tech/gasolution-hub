-- 1) 퇴사 직원은 로그인 이메일 없이 이름만 등록할 수 있게 (예전 실적의 담당자로 남기기 위해)
alter table public.staff alter column email drop not null;
alter table public.staff add constraint staff_active_needs_email check (not is_active or email is not null);

-- 2) 바이럴 건 담당자 자동 지정은 '직접 입력'할 때만.
--    시트에서 옮긴 건(source_sheet 있음)은 담당자를 못 찾으면 비워 둠 (옮긴 사람으로 잘못 들어가지 않게)
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
    if new.staff_id is null and new.source_sheet is null then new.staff_id := public.my_staff_id(); end if;
  end if;
  return new;
end
$$;
revoke execute on function public.viral_orders_before_write() from public, anon, authenticated;
