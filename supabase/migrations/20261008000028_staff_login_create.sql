-- 직원 관리 「로그인 계정 만들기」: 서비스 키 없이 데이터베이스에서 바로 만들고 임시 비밀번호를 한 번 돌려줌
--   대표: 누구나 / 팀장: 일반 직원만. 이메일로 직원에 자동 연결(기존 트리거). 「비밀번호 초기화」도 같은 규칙
create or replace function public.staff_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_ceo() or current_setting('app.staff_link', true) = 'on' then
    return new;
  end if;
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

create or replace function public.staff_login_allowed(p_staff uuid) returns public.staff
language plpgsql stable security definer set search_path = public as $$
declare s public.staff;
begin
  select * into s from public.staff where id = p_staff;
  if s.id is null or not s.is_active then raise exception '재직 중인 직원이 아닙니다'; end if;
  if not (public.is_ceo() or (public.is_manager() and s.role = 'staff')) then
    raise exception '로그인 계정은 대표·팀장만 만들 수 있습니다 (팀장은 일반 직원만)';
  end if;
  if s.email is null or s.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception '이메일을 먼저 등록해 주세요'; end if;
  return s;
end
$$;

create or replace function public.staff_temp_password() returns text
language sql volatile set search_path = public, extensions as $$
  select 'Ga' || translate(encode(extensions.gen_random_bytes(7), 'base64'), '+/=', 'xyz') || '!'
$$;

create or replace function public.staff_create_login(p_staff uuid) returns text
language plpgsql security definer set search_path = public, extensions, auth as $$
declare s public.staff; uid uuid := gen_random_uuid(); pw text := public.staff_temp_password();
begin
  s := public.staff_login_allowed(p_staff);
  if s.auth_user_id is not null then raise exception '이미 로그인 계정이 있습니다'; end if;
  if exists (select 1 from auth.users where lower(email) = lower(s.email)) then raise exception '이 이메일로 이미 로그인 계정이 있습니다'; end if;
  perform set_config('app.staff_link', 'on', true);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token,
                          is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', lower(s.email),
          extensions.crypt(pw, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{"email_verified":true}'::jsonb, now(), now(),
          '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', lower(s.email), 'email_verified', true, 'phone_verified', false), 'email', now(), now());
  update public.staff set auth_user_id = uid where id = s.id and auth_user_id is null;
  perform set_config('app.staff_link', '', true);
  return pw;
end
$$;

create or replace function public.staff_reset_password(p_staff uuid) returns text
language plpgsql security definer set search_path = public, extensions, auth as $$
declare s public.staff; pw text := public.staff_temp_password();
begin
  s := public.staff_login_allowed(p_staff);
  if s.auth_user_id is null then raise exception '로그인 계정이 아직 없습니다'; end if;
  if s.id = public.my_staff_id() then raise exception '본인 비밀번호는 「비밀번호」 화면에서 바꿔 주세요'; end if;
  update auth.users set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')), updated_at = now() where id = s.auth_user_id;
  return pw;
end
$$;

revoke all on function public.staff_login_allowed(uuid), public.staff_temp_password(), public.staff_create_login(uuid), public.staff_reset_password(uuid) from public, anon;
grant execute on function public.staff_create_login(uuid), public.staff_reset_password(uuid) to authenticated;
