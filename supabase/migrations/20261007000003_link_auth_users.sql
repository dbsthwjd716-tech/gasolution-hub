-- 로그인 계정(auth.users)을 만들면 같은 이메일의 직원에 자동으로 연결
-- 대표가 Supabase 화면에서 직원 이메일로 계정을 만들기만 하면 됨 (초대 메일 없음)

create or replace function public.link_staff_to_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.staff
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and auth_user_id is null;
  return new;
end
$$;
revoke execute on function public.link_staff_to_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created_link_staff
  after insert on auth.users
  for each row execute function public.link_staff_to_auth_user();

-- 직원을 나중에 등록해도, 이미 같은 이메일의 로그인 계정이 있으면 바로 연결
create or replace function public.staff_link_existing_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.auth_user_id is null then
    select u.id into new.auth_user_id from auth.users u where lower(u.email) = lower(new.email) limit 1;
  end if;
  return new;
end
$$;
revoke execute on function public.staff_link_existing_auth_user() from public, anon, authenticated;

create trigger staff_link_existing_auth_user
  before insert on public.staff
  for each row execute function public.staff_link_existing_auth_user();
