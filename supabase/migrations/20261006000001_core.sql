-- 지에이솔루션 통합 시스템 1단계: 직원·권한, 거래처, 광고주(브랜드), 매체 계정
-- 원칙
--   * 거래처 = 사업자번호 1개. 사업자번호가 없으면 '임시 거래처'
--   * 권한은 대표(ceo) / 팀장(lead) / 직원(staff) 3가지
--   * 직원은 모든 거래처를 볼 수 있고, 본인 담당 거래처만 고칠 수 있음. 대표·팀장은 전부 수정
--   * 지우기는 대표만. 모든 변경은 change_log에 남김

-- ---------------------------------------------------------------- 직원
create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  name          text not null,
  email         text not null unique,
  role          text not null default 'staff' check (role in ('ceo','lead','staff')),
  is_active     boolean not null default true,
  legacy_dashboard_employee_id bigint unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.staff is '직원. role: ceo=대표, lead=팀장, staff=직원';

-- 로그인한 사람의 직원 정보 (보안 규칙에서 사용)
create or replace function public.my_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.staff where auth_user_id = auth.uid() and is_active
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where auth_user_id = auth.uid() and is_active
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('ceo','lead'), false)
$$;

create or replace function public.is_ceo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'ceo', false)
$$;

-- ---------------------------------------------------------------- 사업자번호
-- 숫자 10자리만 남기고, 국세청 검증번호(마지막 자리)가 맞는지 확인
create or replace function public.normalize_business_number(raw text) returns text
language sql immutable as $$
  select nullif(regexp_replace(coalesce(raw,''), '\D', '', 'g'), '')
$$;

create or replace function public.is_valid_business_number(bn text) returns boolean
language plpgsql immutable as $$
declare
  w int[] := array[1,3,7,1,3,7,1,3,5];
  s int := 0;
  i int;
  d int;
begin
  if bn is null or bn !~ '^\d{10}$' then return false; end if;
  for i in 1..9 loop
    d := substr(bn, i, 1)::int;
    s := s + d * w[i];
  end loop;
  s := s + (substr(bn, 9, 1)::int * 5) / 10;
  return (10 - s % 10) % 10 = substr(bn, 10, 1)::int;
end
$$;

create or replace function public.format_business_number(bn text) returns text
language sql immutable as $$
  select case when bn ~ '^\d{10}$'
    then substr(bn,1,3)||'-'||substr(bn,4,2)||'-'||substr(bn,6,5) end
$$;

-- ---------------------------------------------------------------- 거래처
create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  business_number     text unique
                      check (business_number is null or public.is_valid_business_number(business_number)),
  is_provisional      boolean generated always as (business_number is null) stored,
  company_name        text not null check (length(trim(company_name)) > 0),
  representative_name text,
  address             text,
  business_type       text,   -- 업태
  business_item       text,   -- 종목
  billing_emails      text[] not null default '{}',
  status              text not null default 'active' check (status in ('lead','active','ended')),
  kinds               text[] not null default '{ad}' check (kinds <@ array['ad','viral']::text[] and cardinality(kinds) > 0),
  owner_staff_id      uuid references public.staff(id),
  memo                text,
  created_by          uuid references public.staff(id),
  updated_by          uuid references public.staff(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.clients is '거래처 = 세금계산서를 받는 사업자 1곳. 사업자번호가 없으면 임시 거래처';
create index clients_owner_idx on public.clients(owner_staff_id);

-- 업체 담당자 연락처
create table public.client_contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  role_label  text,          -- 사장님, 실무자, 경리 등
  phone       text,
  email       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index client_contacts_client_idx on public.client_contacts(client_id);

-- 사업자등록증 등 파일
create table public.client_documents (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  document_type text not null default 'business_registration'
                check (document_type in ('business_registration','bank_account','other')),
  file_name     text not null,
  storage_path  text not null,
  mime_type     text,
  file_size     bigint,
  uploaded_by   uuid references public.staff(id),
  created_at    timestamptz not null default now()
);
create index client_documents_client_idx on public.client_documents(client_id);

-- ---------------------------------------------------------------- 광고주(브랜드)
create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id),
  name        text not null check (length(trim(name)) > 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, name)
);
comment on table public.brands is '광고주(브랜드·매장). 한 거래처가 여러 브랜드를 운영할 수 있음';
create index brands_client_idx on public.brands(client_id);

-- ---------------------------------------------------------------- 다른 이름 목록
-- 시트·CRM·계정마다 다르게 쓰던 이름을 모아 두고, 같은 이름이 들어오면 같은 거래처로 연결
create or replace function public.normalize_name(raw text) returns text
language sql immutable as $$
  select lower(regexp_replace(
           regexp_replace(coalesce(raw,''), '(주식회사|\(주\)|㈜)', '', 'g'),
           '[\s\-_\.\(\)\[\]/·,]', '', 'g'))
$$;

create table public.name_aliases (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  brand_id    uuid references public.brands(id) on delete cascade,
  alias       text not null,
  normalized  text generated always as (public.normalize_name(alias)) stored,
  source      text not null default 'manual'
              check (source in ('manual','dashboard','billing','crm','viral','report')),
  created_at  timestamptz not null default now(),
  unique (normalized)
);

-- ---------------------------------------------------------------- 매체 계정
create table public.media_accounts (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid not null references public.brands(id),
  platform      text not null check (platform in ('naver_searchad','naver_gfa','meta','naver_place','kakao','other')),
  external_id   text not null,
  account_name  text,
  transferred_at date,           -- 이관(다른 대행사로 넘어감) 날짜
  is_active     boolean not null default true,
  legacy_dashboard_advertiser_id bigint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (platform, external_id)
);
create index media_accounts_brand_idx on public.media_accounts(brand_id);

-- 계정별 담당 직원과 담당 기간 (인수인계 이력)
create table public.media_account_assignments (
  id                uuid primary key default gen_random_uuid(),
  media_account_id  uuid not null references public.media_accounts(id) on delete cascade,
  staff_id          uuid not null references public.staff(id),
  valid_from        date not null default current_date,
  valid_to          date,
  created_at        timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index maa_account_idx on public.media_account_assignments(media_account_id);
create index maa_staff_idx on public.media_account_assignments(staff_id);

-- ---------------------------------------------------------------- 수정 권한 판단
-- 대표·팀장: 전부. 직원: 거래처 담당자이거나, 그 거래처 계정의 현재 담당자일 때
create or replace function public.can_edit_client(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
      or exists (select 1 from public.clients c
                 where c.id = cid and c.owner_staff_id = public.my_staff_id())
      or exists (select 1 from public.brands b
                 join public.media_accounts m on m.brand_id = b.id
                 join public.media_account_assignments a on a.media_account_id = m.id
                 where b.client_id = cid
                   and a.staff_id = public.my_staff_id()
                   and (a.valid_to is null or a.valid_to >= current_date))
$$;

create or replace function public.client_of_brand(bid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from public.brands where id = bid
$$;

create or replace function public.client_of_account(aid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select b.client_id from public.media_accounts m join public.brands b on b.id = m.brand_id where m.id = aid
$$;

-- ---------------------------------------------------------------- 자동 처리
-- 저장 전에 사업자번호 정리, 수정한 사람·시간 기록
create or replace function public.clients_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.business_number := public.normalize_business_number(new.business_number);
  new.updated_at := now();
  new.updated_by := coalesce(public.my_staff_id(), new.updated_by);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(public.my_staff_id(), new.created_by);
    if new.owner_staff_id is null then new.owner_staff_id := public.my_staff_id(); end if;
  end if;
  return new;
end
$$;
create trigger clients_before_write before insert or update on public.clients
  for each row execute function public.clients_before_write();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger brands_touch before update on public.brands for each row execute function public.touch_updated_at();
create trigger media_accounts_touch before update on public.media_accounts for each row execute function public.touch_updated_at();
create trigger staff_touch before update on public.staff for each row execute function public.touch_updated_at();

-- 직원은 본인 역할을 바꿀 수 없음 (대표만 역할 변경)
create or replace function public.staff_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_ceo()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
          or new.auth_user_id is distinct from old.auth_user_id or new.email is distinct from old.email) then
    raise exception '역할·계정 상태는 대표만 바꿀 수 있습니다';
  end if;
  return new;
end
$$;
create trigger staff_guard before update on public.staff for each row execute function public.staff_guard();

-- ---------------------------------------------------------------- 변경 기록
create table public.change_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      uuid,
  action      text not null,
  changed_by  uuid references public.staff(id),
  changed_at  timestamptz not null default now(),
  before      jsonb,
  after       jsonb
);
create index change_log_row_idx on public.change_log(table_name, row_id);

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.change_log(table_name, row_id, action, changed_by, before, after)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end)),
          lower(tg_op), public.my_staff_id(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end
$$;
create trigger clients_log after insert or update or delete on public.clients for each row execute function public.log_change();
create trigger brands_log after insert or update or delete on public.brands for each row execute function public.log_change();
create trigger media_accounts_log after insert or update or delete on public.media_accounts for each row execute function public.log_change();
create trigger contacts_log after insert or update or delete on public.client_contacts for each row execute function public.log_change();
create trigger staff_log after insert or update or delete on public.staff for each row execute function public.log_change();

-- ---------------------------------------------------------------- 보안 규칙
alter table public.staff enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.client_documents enable row level security;
alter table public.brands enable row level security;
alter table public.name_aliases enable row level security;
alter table public.media_accounts enable row level security;
alter table public.media_account_assignments enable row level security;
alter table public.change_log enable row level security;

-- 로그인하지 않은 사람(anon)은 어떤 표도 직접 못 봄
revoke all on all tables in schema public from anon;

-- 직원 목록: 직원이면 누구나 보기. 추가·삭제는 대표만. 본인 이름·연락처는 본인이 수정
create policy staff_select on public.staff for select to authenticated using (public.my_staff_id() is not null);
create policy staff_insert on public.staff for insert to authenticated with check (public.is_ceo());
create policy staff_update on public.staff for update to authenticated
  using (public.is_ceo() or id = public.my_staff_id()) with check (public.is_ceo() or id = public.my_staff_id());
create policy staff_delete on public.staff for delete to authenticated using (public.is_ceo());

-- 거래처: 직원이면 보기·등록. 수정은 담당자·대표·팀장. 삭제는 대표
create policy clients_select on public.clients for select to authenticated using (public.my_staff_id() is not null);
create policy clients_insert on public.clients for insert to authenticated with check (public.my_staff_id() is not null);
create policy clients_update on public.clients for update to authenticated
  using (public.can_edit_client(id)) with check (public.can_edit_client(id));
create policy clients_delete on public.clients for delete to authenticated using (public.is_ceo());

-- 거래처에 딸린 정보는 그 거래처 권한을 따름
create policy contacts_select on public.client_contacts for select to authenticated using (public.my_staff_id() is not null);
create policy contacts_write on public.client_contacts for all to authenticated
  using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));

create policy documents_select on public.client_documents for select to authenticated using (public.my_staff_id() is not null);
create policy documents_write on public.client_documents for all to authenticated
  using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));

create policy brands_select on public.brands for select to authenticated using (public.my_staff_id() is not null);
create policy brands_insert on public.brands for insert to authenticated with check (public.can_edit_client(client_id));
create policy brands_update on public.brands for update to authenticated
  using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));
create policy brands_delete on public.brands for delete to authenticated using (public.is_ceo());

create policy aliases_select on public.name_aliases for select to authenticated using (public.my_staff_id() is not null);
create policy aliases_write on public.name_aliases for all to authenticated
  using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));

create policy accounts_select on public.media_accounts for select to authenticated using (public.my_staff_id() is not null);
create policy accounts_insert on public.media_accounts for insert to authenticated
  with check (public.can_edit_client(public.client_of_brand(brand_id)));
create policy accounts_update on public.media_accounts for update to authenticated
  using (public.can_edit_client(public.client_of_brand(brand_id)))
  with check (public.can_edit_client(public.client_of_brand(brand_id)));
create policy accounts_delete on public.media_accounts for delete to authenticated using (public.is_ceo());

-- 담당자 지정은 대표·팀장만
create policy assignments_select on public.media_account_assignments for select to authenticated using (public.my_staff_id() is not null);
create policy assignments_write on public.media_account_assignments for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- 변경 기록은 대표·팀장만 보고, 직접 쓰거나 고칠 수 없음 (자동 기록만)
create policy change_log_select on public.change_log for select to authenticated using (public.is_manager());

-- 함수 실행 권한: 로그인 안 한 사람은 불가
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
