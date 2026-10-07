-- 새 Supabase 프로젝트는 표를 만들어도 로그인한 사용자(authenticated)에게 자동으로 열어주지 않음.
-- 로그인한 사용자에게 표 사용 권한을 주고, 실제로 무엇을 보고 고칠 수 있는지는 각 표의 보안 규칙(RLS)이 정함.
-- 로그인하지 않은 사람(anon)에게는 계속 아무것도 열지 않음.

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 앞으로 만드는 표도 같은 방식으로
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- 변경 기록은 자동으로만 쌓이고, 사람이 직접 쓰거나 고치거나 지울 수 없게
revoke insert, update, delete on public.change_log from authenticated;
