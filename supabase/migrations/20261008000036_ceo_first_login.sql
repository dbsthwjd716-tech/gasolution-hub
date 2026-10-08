-- 대표 첫 로그인: 로그인 계정이 있는 대표가 한 명도 없을 때만 팀장이 대표 로그인 계정을 만들 수 있음 (한 번뿐)
--   대표 계정이 생기면 예전처럼 대표·팀장 계정은 대표만 만들고 비밀번호도 대표만 초기화
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
        and not exists (select 1 from public.staff c where c.role = 'ceo' and c.is_active and c.auth_user_id is not null))
  ) then
    raise exception '로그인 계정은 대표·팀장만 만들 수 있습니다 (팀장은 일반 직원만)';
  end if;
  if s.email is null or s.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception '이메일을 먼저 등록해 주세요'; end if;
  return s;
end
$$;
