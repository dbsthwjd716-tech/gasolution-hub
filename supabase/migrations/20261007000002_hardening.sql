-- 보안·성능 보강 (Supabase 점검 결과 반영)

-- 1) 앞으로 새로 만드는 표·함수도 로그인하지 않은 사람(anon)에게 자동으로 열리지 않도록
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- 2) 자동 처리(트리거) 함수는 외부에서 직접 부를 이유가 없으므로 막음 (트리거는 그대로 동작)
revoke execute on function public.clients_before_write() from authenticated;
revoke execute on function public.log_change() from authenticated;
revoke execute on function public.staff_guard() from authenticated;
revoke execute on function public.viral_orders_before_write() from authenticated;
revoke execute on function public.viral_orders_mark_client() from authenticated;
revoke execute on function public.touch_updated_at() from authenticated;
-- 쓰지 않는 함수 정리
drop function if exists public.client_of_account(uuid);

-- 3) 계산용 함수의 검색 경로 고정
alter function public.format_business_number(text) set search_path = '';
alter function public.normalize_business_number(text) set search_path = '';
alter function public.is_valid_business_number(text) set search_path = '';
alter function public.normalize_name(text) set search_path = '';
alter function public.touch_updated_at() set search_path = '';

-- 4) '보기'와 '쓰기' 규칙이 겹치던 표는 쓰기 규칙을 추가·수정·삭제로 나눔 (같은 권한, 검사만 한 번)
drop policy contacts_write on public.client_contacts;
create policy contacts_insert on public.client_contacts for insert to authenticated with check (public.can_edit_client(client_id));
create policy contacts_update on public.client_contacts for update to authenticated using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
create policy contacts_delete on public.client_contacts for delete to authenticated using (public.can_edit_client(client_id));

drop policy documents_write on public.client_documents;
create policy documents_insert on public.client_documents for insert to authenticated with check (public.can_edit_client(client_id));
create policy documents_update on public.client_documents for update to authenticated using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
create policy documents_delete on public.client_documents for delete to authenticated using (public.can_edit_client(client_id));

drop policy aliases_write on public.name_aliases;
create policy aliases_insert on public.name_aliases for insert to authenticated with check (public.can_edit_client(client_id));
create policy aliases_update on public.name_aliases for update to authenticated using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
create policy aliases_delete on public.name_aliases for delete to authenticated using (public.can_edit_client(client_id));

drop policy assignments_write on public.media_account_assignments;
create policy assignments_insert on public.media_account_assignments for insert to authenticated with check (public.is_manager());
create policy assignments_update on public.media_account_assignments for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy assignments_delete on public.media_account_assignments for delete to authenticated using (public.is_manager());

drop policy partners_write on public.viral_partners;
create policy partners_insert on public.viral_partners for insert to authenticated with check (public.is_manager());
create policy partners_update on public.viral_partners for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy partners_delete on public.viral_partners for delete to authenticated using (public.is_manager());

-- 5) 연결 칸 검색 속도 (외래키 색인)
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
