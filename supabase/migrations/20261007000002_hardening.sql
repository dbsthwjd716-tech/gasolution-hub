-- 보안·성능 보강 (Supabase 점검 결과 반영). 실제 프로젝트에 적용된 내용과 같음

-- 1) 앞으로 새로 만드는 표·함수도 로그인하지 않은 사람(anon)에게 자동으로 열리지 않도록
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- 2) 자동 처리(트리거) 함수와 쓰지 않는 함수는 외부에서 직접 부를 수 없게 (트리거는 그대로 동작)
revoke execute on function public.clients_before_write() from authenticated;
revoke execute on function public.log_change() from authenticated;
revoke execute on function public.staff_guard() from authenticated;
revoke execute on function public.viral_orders_before_write() from authenticated;
revoke execute on function public.viral_orders_mark_client() from authenticated;
revoke execute on function public.touch_updated_at() from authenticated;
revoke execute on function public.client_of_account(uuid) from authenticated;

-- 3) 계산용 함수의 검색 경로 고정
alter function public.format_business_number(text) set search_path = '';
alter function public.normalize_business_number(text) set search_path = '';
alter function public.is_valid_business_number(text) set search_path = '';
alter function public.normalize_name(text) set search_path = '';
alter function public.touch_updated_at() set search_path = '';

-- 4) 연결 칸 검색 속도 (외래키 색인)
create index if not exists change_log_changed_by_idx on public.change_log(changed_by);
create index if not exists client_documents_uploaded_by_idx on public.client_documents(uploaded_by);
create index if not exists clients_created_by_idx on public.clients(created_by);
create index if not exists clients_updated_by_idx on public.clients(updated_by);
create index if not exists name_aliases_brand_idx on public.name_aliases(brand_id);
create index if not exists name_aliases_client_idx on public.name_aliases(client_id);
create index if not exists viral_orders_brand_idx on public.viral_orders(brand_id);
create index if not exists viral_orders_partner_idx on public.viral_orders(partner_id);
create index if not exists viral_orders_created_by_idx on public.viral_orders(created_by);
create index if not exists viral_orders_updated_by_idx on public.viral_orders(updated_by);
