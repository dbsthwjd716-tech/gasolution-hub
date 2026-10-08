-- 대표 첫 로그인 보완: 대표가 아직 한 번도 로그인하지 않았으면 팀장이 대표 임시 비밀번호를 다시 받을 수 있음
--   (계정을 만든 직후 임시 비밀번호를 놓친 경우). 대표가 한 번 로그인하면 대표 계정은 대표만 관리
create or replace function public.staff_login_allowed(p_staff uuid) returns public.staff
language plpgsql stable security definer set search_path = public as $$
declare s public.staff;
begin
  select * into s from public.staff where id = p_staff;
  if s.id is null or not s.is_active then raise exception '재직 중인 직원이 아닙니다'; end if;
  if not (
    public.is_ceo()
    or (public.is_manager() and s.role = 'staff')
    or (public.is_manager() and s.role = 'ceo'
        and not exists (select 1 from public.staff c join auth.users u on u.id = c.auth_user_id
                         where c.role = 'ceo' and c.is_active and u.last_sign_in_at is not null))
  ) then
    raise exception '로그인 계정은 대표·팀장만 만들 수 있습니다 (팀장은 일반 직원만, 대표 계정은 대표가 한 번 로그인한 뒤로는 대표만)';
  end if;
  if s.email is null or s.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception '이메일을 먼저 등록해 주세요'; end if;
  return s;
end
$$;
