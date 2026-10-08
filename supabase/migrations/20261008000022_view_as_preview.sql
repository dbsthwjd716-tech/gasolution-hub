-- 직원 화면 미리보기: 대표·팀장이 일반 직원 화면을 그 직원 권한 그대로 봄 (읽기만, 저장·변경은 모두 막힘)
--   허브 서버가 요청 머리말 x-hub-view-as 에 직원 id를 실어 보냄
--   * 로그인한 사람이 대표·팀장이고, 대상이 재직 중인 일반 직원일 때만 적용 (그 외에는 무시)
--   * 권한 판단은 모두 my_staff_id / my_role / can_view_cost 를 거치므로, 이 셋만 바꾸면 보안 규칙 전체가 그 직원 기준으로 바뀜
--   * 미리보기 중에는 모든 표의 추가·수정·삭제를 막음

create or replace function public.view_as_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  h text := current_setting('request.headers', true);
  v text;
  t uuid;
begin
  if h is null or position('x-hub-view-as' in h) = 0 then
    return null;
  end if;
  v := h::json ->> 'x-hub-view-as';
  if v is null or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  if not exists (select 1 from staff where auth_user_id = auth.uid() and is_active and role in ('ceo', 'lead')) then
    return null;
  end if;
  select id into t from staff where id = v::uuid and is_active and role = 'staff';
  return t;
end
$$;

create or replace function public.my_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(public.view_as_id(), (select id from public.staff where auth_user_id = auth.uid() and is_active))
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select case when public.view_as_id() is not null then 'staff'
              else (select role from public.staff where auth_user_id = auth.uid() and is_active) end
$$;

create or replace function public.can_view_cost() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
      or coalesce((select can_view_cost from public.staff where id = public.my_staff_id() and is_active), false)
$$;

create or replace function public.preview_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.view_as_id() is not null then
    raise exception '직원 화면 미리보기 중에는 저장·변경할 수 없습니다. 미리보기를 끝낸 뒤 다시 해 주세요.' using errcode = '42501';
  end if;
  return null;
end
$$;

-- 모든 표에 미리보기 쓰기 차단 (새 표를 만들면 같은 줄을 추가해야 함 — 시험이 빠진 표를 잡아냄)
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop trigger if exists zz_preview_block on public.%I', r.tablename);
    execute format('create trigger zz_preview_block before insert or update or delete on public.%I for each statement execute function public.preview_block()', r.tablename);
  end loop;
end
$$;

grant execute on function public.view_as_id() to authenticated;
