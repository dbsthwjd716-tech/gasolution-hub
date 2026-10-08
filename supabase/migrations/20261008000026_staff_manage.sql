-- 직원 관리: 팀장도 일반 직원 추가·퇴사 처리·이메일 수정 가능
--   역할(대표/팀장/직원) 변경, 공급가 보기 권한, 대표·팀장 계정 변경은 계속 대표만
create policy staff_insert_manager on public.staff for insert to authenticated
  with check (public.is_manager() and role = 'staff' and not can_view_cost);
create policy staff_update_manager on public.staff for update to authenticated
  using (public.is_manager() and role = 'staff') with check (public.is_manager() and role = 'staff');

create or replace function public.staff_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_ceo() then
    return new;
  end if;
  -- 팀장: 일반 직원의 재직 상태·이메일만 (역할·공급가 권한·계정 연결은 대표만)
  if public.is_manager() and old.role = 'staff' and new.role = 'staff'
     and new.can_view_cost is not distinct from old.can_view_cost
     and new.auth_user_id is not distinct from old.auth_user_id then
    return new;
  end if;
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active
     or new.auth_user_id is distinct from old.auth_user_id or new.email is distinct from old.email
     or new.can_view_cost is distinct from old.can_view_cost then
    raise exception '역할·계정 상태·공급가 보기 권한은 대표만 바꿀 수 있습니다';
  end if;
  return new;
end
$$;
