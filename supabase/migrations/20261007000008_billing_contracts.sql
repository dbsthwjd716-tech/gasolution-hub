-- 3단계: 계약 · 정산(세금계산서 발행요청) · 견적
--   * 계약 = 거래처별 마크업 조건의 기준. 정산 작성 시 유효한 계약 조건이 자동으로 들어감
--   * 정산·견적 문서: 직원 요청 → 팀장 1차 승인 → 대표 최종 승인 → 세금계산서 발행 완료 체크
--     (견적은 팀장·대표 중 한 명 확인으로 끝)
--   * 승인 이후에는 금액을 고칠 수 없음 (반려 → 수정 → 재요청)
--   * 발행 사업장(지에이솔루션/카피코치랩)의 사업자·계좌 정보는 저장소(코드)가 아니라 DB에만 둠

-- ---------------------------------------------------------------- 발행 사업장
create table public.suppliers (
  code                text primary key check (code ~ '^[a-z]+$'),
  name                text not null,
  representative_name text,
  business_number     text,
  address             text,
  business_type       text,
  phone               text,
  email               text,
  bank_account        text,   -- 예: 기업은행 000-000000-00-000
  bank_holder         text,
  sort_order          integer not null default 0,
  is_active           boolean not null default true
);
comment on table public.suppliers is '문서를 발행하는 우리 쪽 사업장 (지에이솔루션, 카피코치랩)';

-- ---------------------------------------------------------------- 계약
create table public.contracts (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id),
  brand_id          uuid references public.brands(id),
  staff_id          uuid references public.staff(id),          -- 담당
  contract_date     date not null default ((now() at time zone 'Asia/Seoul')::date),
  start_date        date,
  end_date          date,
  media             text[] not null default '{}'
                    check (media <@ array['naver','gfa','meta','google','kakao','coupang','other']::text[]),
  markup_type       text not null default 'rate' check (markup_type in ('rate','fixed','none')),
  markup_rate       numeric(5,2) not null default 0 check (markup_rate >= 0 and markup_rate < 100),
  markup_fixed      bigint not null default 0 check (markup_fixed >= 0),
  min_fee           bigint not null default 0 check (min_fee >= 0),   -- 최소 대행비 (예: 33만원)
  vat_mode          text not null default 'included' check (vat_mode in ('included','excluded')),
  auto_renew        boolean not null default true,
  document_required boolean not null default true,              -- 계약서를 쓰는 계약인지
  special_terms     text,
  status            text not null default 'draft'
                    check (status in ('draft','signing','active','on_hold','rejected','ended')),
  completion_type   text check (completion_type in ('signed_document','no_document')),
  signed_file_path  text,
  signed_file_name  text,
  rejection_reason  text,
  completed_by      uuid references public.staff(id),
  completed_at      timestamptz,
  created_by        uuid references public.staff(id),
  updated_by        uuid references public.staff(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (status <> 'active' or completion_type is not null),
  check (completion_type is distinct from 'signed_document' or signed_file_path is not null)
);
comment on table public.contracts is '광고대행 계약. 마크업 요율·최소 대행비·VAT 처리의 기준';
comment on column public.contracts.status is 'draft 작성중 / signing 서명 진행중 / active 계약완료 / on_hold 보류 / rejected 반려 / ended 종료';
create index contracts_client_idx on public.contracts(client_id);
create index contracts_brand_idx on public.contracts(brand_id);
create index contracts_staff_idx on public.contracts(staff_id);

create or replace function public.contracts_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.brand_id is not null and public.client_of_brand(new.brand_id) is distinct from new.client_id then
    raise exception '선택한 브랜드가 이 거래처의 브랜드가 아닙니다';
  end if;
  if public.my_staff_id() is not null and not public.is_manager() then
    if new.status in ('active','rejected','on_hold','ended')
       and new.status is distinct from (case when tg_op = 'UPDATE' then old.status end) then
      raise exception '계약 완료·반려·보류·종료는 대표·팀장만 할 수 있습니다';
    end if;
    if tg_op = 'UPDATE' and old.status in ('active','ended') then
      raise exception '완료된 계약은 대표·팀장만 고칠 수 있습니다';
    end if;
  end if;
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    new.completed_by := coalesce(public.my_staff_id(), new.completed_by);
    new.completed_at := now();
  end if;
  if new.status <> 'rejected' then new.rejection_reason := null; end if;
  new.updated_at := now();
  new.updated_by := coalesce(public.my_staff_id(), new.updated_by);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(public.my_staff_id(), new.created_by);
    new.staff_id := coalesce(new.staff_id, public.my_staff_id());
  end if;
  return new;
end
$$;
create trigger contracts_before_write before insert or update on public.contracts
  for each row execute function public.contracts_before_write();
create trigger contracts_log after insert or update or delete on public.contracts
  for each row execute function public.log_change();

-- ---------------------------------------------------------------- 정산·견적 문서
create table public.billing_documents (
  id                            uuid primary key default gen_random_uuid(),
  doc_type                      text not null
                                check (doc_type in ('settlement','viral_estimate','detailed_estimate','simple_estimate')),
  supplier_code                 text not null default 'ga' references public.suppliers(code),
  client_id                     uuid not null references public.clients(id),
  contract_id                   uuid references public.contracts(id),
  staff_id                      uuid references public.staff(id),      -- 담당(요청자)
  document_date                 date not null default ((now() at time zone 'Asia/Seoul')::date),
  period_start                  date,
  period_end                    date,
  -- 받는 곳: 저장 시점의 거래처 정보를 그대로 남김 (나중에 거래처 정보가 바뀌어도 문서는 그대로)
  recipient_company_name        text not null,
  recipient_representative_name text,
  recipient_business_number     text,
  recipient_address             text,
  recipient_emails              text[] not null default '{}',
  -- 정산 계산 근거
  spend_amount                  bigint not null default 0,     -- 광고비 소진액 (계산 기준, 청구 안 함)
  markup_type                   text not null default 'none' check (markup_type in ('rate','fixed','none')),
  markup_rate                   numeric(5,2) not null default 0,
  markup_fixed                  bigint not null default 0,
  min_fee                       bigint not null default 0,
  vat_mode                      text not null default 'included' check (vat_mode in ('included','excluded')),
  markup_amount                 bigint not null default 0,     -- 마크업 비용 (최소 대행비 반영 후)
  -- 청구 금액
  supply_amount                 bigint not null default 0,
  vat_amount                    bigint not null default 0,
  adjustment_amount             bigint not null default 0,     -- 추가(+)/차감(-)
  adjustment_reason             text,
  total_amount                  bigint not null default 0,
  note                          text,
  status                        text not null default 'draft'
                                check (status in ('draft','requested','lead_approved','approved','issued','rejected','cancelled')),
  rejection_reason              text,
  requested_at                  timestamptz,
  lead_approved_by              uuid references public.staff(id),
  lead_approved_at              timestamptz,
  approved_by                   uuid references public.staff(id),
  approved_at                   timestamptz,
  issued_by                     uuid references public.staff(id),
  issued_at                     timestamptz,
  payment_received              boolean not null default false,
  paid_at                       date,
  created_by                    uuid references public.staff(id),
  updated_by                    uuid references public.staff(id),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  check (total_amount = supply_amount + vat_amount + adjustment_amount),
  check (adjustment_amount = 0 or length(trim(coalesce(adjustment_reason, ''))) > 0),
  check (period_end is null or period_start is null or period_end >= period_start),
  check (doc_type = 'settlement' or status <> 'issued'),
  check (status <> 'rejected' or length(trim(coalesce(rejection_reason, ''))) > 0)
);
comment on table public.billing_documents is '광고비 정산(세금계산서 발행요청)과 견적서';
comment on column public.billing_documents.status is 'draft 작성중 / requested 승인 요청 / lead_approved 1차 승인 / approved 최종 승인(발행요청 완료) / issued 세금계산서 발행 완료 / rejected 반려 / cancelled 취소';
create index billing_documents_client_idx on public.billing_documents(client_id);
create index billing_documents_contract_idx on public.billing_documents(contract_id);
create index billing_documents_staff_idx on public.billing_documents(staff_id);
create index billing_documents_date_idx on public.billing_documents(document_date);

create table public.billing_items (
  id                  uuid primary key default gen_random_uuid(),
  billing_document_id uuid not null references public.billing_documents(id) on delete cascade,
  sort_order          integer not null default 0,
  item_name           text not null check (length(trim(item_name)) > 0),
  description         text,
  unit_price          bigint not null default 0,
  quantity            numeric(12,2) not null default 1,
  supply_amount       bigint not null default 0,
  vat_amount          bigint not null default 0,
  total_amount        bigint not null default 0,
  created_at          timestamptz not null default now(),
  check (total_amount = supply_amount + vat_amount)
);
create index billing_items_doc_idx on public.billing_items(billing_document_id);

create table public.billing_files (
  id                  uuid primary key default gen_random_uuid(),
  billing_document_id uuid not null references public.billing_documents(id) on delete cascade,
  file_type           text not null default 'spend_evidence' check (file_type in ('spend_evidence','other')),
  file_name           text not null,
  storage_path        text not null,
  mime_type           text,
  file_size           bigint,
  uploaded_by         uuid references public.staff(id) default public.my_staff_id(),
  created_at          timestamptz not null default now()
);
create index billing_files_doc_idx on public.billing_files(billing_document_id);

-- 승인 흐름 기록 (자동으로만 쌓임)
create table public.billing_logs (
  id                  bigint generated always as identity primary key,
  billing_document_id uuid not null references public.billing_documents(id) on delete cascade,
  actor_staff_id      uuid references public.staff(id),
  from_status         text,
  to_status           text not null,
  reason              text,
  created_at          timestamptz not null default now()
);
create index billing_logs_doc_idx on public.billing_logs(billing_document_id);
create index billing_logs_actor_idx on public.billing_logs(actor_staff_id);

-- 누가 이 문서를 고칠 수 있나: 대표·팀장 또는 담당자
create or replace function public.can_edit_billing(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager() or (sid is not null and sid = public.my_staff_id())
$$;

-- 품목·첨부를 바꿀 수 있나: 고칠 수 있는 사람 + 아직 승인 전 문서
create or replace function public.can_edit_billing_content(did uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.billing_documents d
                 where d.id = did and d.status in ('draft','requested','rejected')
                   and public.can_edit_billing(d.staff_id))
$$;

create or replace function public.billing_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_staff_id();
  role text := public.my_role();
  old_status text := case when tg_op = 'UPDATE' then old.status end;
  ok boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(me, new.created_by);
    new.staff_id := coalesce(new.staff_id, me);
    if me is not null and new.status not in ('draft','requested') then
      raise exception '새 문서는 작성중 또는 승인 요청 상태로만 만들 수 있습니다';
    end if;
  end if;

  -- 승인 이후에는 금액·거래처를 고칠 수 없음
  if tg_op = 'UPDATE' and old.status in ('lead_approved','approved','issued','cancelled')
     and (new.doc_type, new.client_id, new.supply_amount, new.vat_amount, new.adjustment_amount,
          new.total_amount, new.spend_amount, new.markup_amount, new.supplier_code)
         is distinct from
         (old.doc_type, old.client_id, old.supply_amount, old.vat_amount, old.adjustment_amount,
          old.total_amount, old.spend_amount, old.markup_amount, old.supplier_code) then
    raise exception '승인된 문서는 금액을 고칠 수 없습니다. 반려 후 수정해 다시 요청해 주세요';
  end if;

  if me is not null and new.status is distinct from old_status and tg_op = 'UPDATE' then
    ok := case
      -- 담당자: 요청·회수·재요청
      when (old_status, new.status) in (('draft','requested'),('rejected','requested'),
                                        ('requested','draft'),('rejected','draft'))
        then public.can_edit_billing(old.staff_id)
      -- 정산: 팀장 1차 승인 → 대표 최종 승인. 대표는 바로 최종 승인 가능
      when new.doc_type = 'settlement' and old_status = 'requested' and new.status = 'lead_approved'
        then role in ('lead','ceo')
      when new.doc_type = 'settlement' and old_status in ('requested','lead_approved') and new.status = 'approved'
        then role = 'ceo'
      when new.doc_type = 'settlement' and old_status = 'approved' and new.status = 'issued'
        then role in ('lead','ceo')
      when new.doc_type = 'settlement' and old_status = 'issued' and new.status = 'approved'
        then role in ('lead','ceo')
      -- 견적: 팀장·대표 중 한 명 확인으로 끝
      when new.doc_type <> 'settlement' and old_status = 'requested' and new.status = 'approved'
        then role in ('lead','ceo')
      when old_status in ('requested','lead_approved','approved') and new.status = 'rejected'
        then role in ('lead','ceo')
      when new.status = 'cancelled'
        then role in ('lead','ceo')
      else false
    end;
    if not coalesce(ok, false) then
      raise exception '이 단계로 바꿀 권한이 없습니다';
    end if;
  end if;

  if new.status is distinct from old_status then
    if new.status = 'requested' then
      new.requested_at := now();
      new.lead_approved_by := null; new.lead_approved_at := null;
      new.approved_by := null; new.approved_at := null;
    elsif new.status = 'lead_approved' then
      new.lead_approved_by := me; new.lead_approved_at := now();
    elsif new.status = 'approved' and old_status is distinct from 'issued' then
      new.approved_by := me; new.approved_at := now();
    elsif new.status = 'issued' then
      new.issued_by := me; new.issued_at := now();
    end if;
    if new.status = 'approved' and old_status = 'issued' then
      new.issued_by := null; new.issued_at := null;
    end if;
  end if;
  if new.status <> 'rejected' then new.rejection_reason := null; end if;
  if new.payment_received and new.paid_at is null then
    new.paid_at := (now() at time zone 'Asia/Seoul')::date;
  elsif not new.payment_received then
    new.paid_at := null;
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(me, new.updated_by);
  return new;
end
$$;
create trigger billing_before_write before insert or update on public.billing_documents
  for each row execute function public.billing_before_write();

create or replace function public.billing_after_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.billing_logs(billing_document_id, actor_staff_id, from_status, to_status, reason)
    values (new.id, public.my_staff_id(), case when tg_op = 'UPDATE' then old.status end, new.status,
            case when new.status = 'rejected' then new.rejection_reason end);
  end if;
  return null;
end
$$;
create trigger billing_after_status after insert or update on public.billing_documents
  for each row execute function public.billing_after_status();
create trigger billing_documents_log after insert or update or delete on public.billing_documents
  for each row execute function public.log_change();
create trigger billing_items_log after insert or update or delete on public.billing_items
  for each row execute function public.log_change();
create trigger billing_files_log after insert or update or delete on public.billing_files
  for each row execute function public.log_change();

revoke execute on function public.contracts_before_write() from public, anon, authenticated;
revoke execute on function public.billing_before_write() from public, anon, authenticated;
revoke execute on function public.billing_after_status() from public, anon, authenticated;
revoke execute on function public.can_edit_billing(uuid) from public, anon;
revoke execute on function public.can_edit_billing_content(uuid) from public, anon;
grant execute on function public.can_edit_billing(uuid) to authenticated;
grant execute on function public.can_edit_billing_content(uuid) to authenticated;

-- ---------------------------------------------------------------- 보안 규칙
alter table public.suppliers enable row level security;
alter table public.contracts enable row level security;
alter table public.billing_documents enable row level security;
alter table public.billing_items enable row level security;
alter table public.billing_files enable row level security;
alter table public.billing_logs enable row level security;

revoke all on public.suppliers, public.contracts, public.billing_documents,
              public.billing_items, public.billing_files, public.billing_logs from anon;
grant select, insert, update, delete on public.suppliers, public.contracts, public.billing_documents,
              public.billing_items, public.billing_files to authenticated;
grant select on public.billing_logs to authenticated;
revoke insert, update, delete on public.billing_logs from authenticated;

create policy suppliers_select on public.suppliers for select to authenticated using (public.my_staff_id() is not null);
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy contracts_select on public.contracts for select to authenticated using (public.my_staff_id() is not null);
create policy contracts_insert on public.contracts for insert to authenticated with check (public.my_staff_id() is not null);
create policy contracts_update on public.contracts for update to authenticated
  using (public.can_edit_billing(staff_id)) with check (public.can_edit_billing(staff_id));
create policy contracts_delete on public.contracts for delete to authenticated using (public.is_manager());

create policy billing_select on public.billing_documents for select to authenticated using (public.my_staff_id() is not null);
create policy billing_insert on public.billing_documents for insert to authenticated with check (public.my_staff_id() is not null);
create policy billing_update on public.billing_documents for update to authenticated
  using (public.can_edit_billing(staff_id)) with check (public.can_edit_billing(staff_id));
create policy billing_delete on public.billing_documents for delete to authenticated
  using (public.is_manager() or (staff_id = public.my_staff_id() and status in ('draft','rejected')));

create policy billing_items_select on public.billing_items for select to authenticated using (public.my_staff_id() is not null);
create policy billing_items_insert on public.billing_items for insert to authenticated
  with check (public.can_edit_billing_content(billing_document_id));
create policy billing_items_update on public.billing_items for update to authenticated
  using (public.can_edit_billing_content(billing_document_id)) with check (public.can_edit_billing_content(billing_document_id));
create policy billing_items_delete on public.billing_items for delete to authenticated
  using (public.can_edit_billing_content(billing_document_id));

create policy billing_files_select on public.billing_files for select to authenticated using (public.my_staff_id() is not null);
create policy billing_files_insert on public.billing_files for insert to authenticated
  with check (public.can_edit_billing_content(billing_document_id));
create policy billing_files_delete on public.billing_files for delete to authenticated
  using (public.can_edit_billing_content(billing_document_id));

create policy billing_logs_select on public.billing_logs for select to authenticated using (public.my_staff_id() is not null);

-- ---------------------------------------------------------------- 파일 보관함 (Supabase Storage)
-- 시험용 DB에는 storage가 없으므로 있을 때만 만듦
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('hub-files', 'hub-files', false, 20971520,
            array['application/pdf','image/png','image/jpeg','image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy hub_files_select on storage.objects for select to authenticated
      using (bucket_id = 'hub-files' and public.my_staff_id() is not null)$p$;
    execute $p$create policy hub_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'hub-files' and public.my_staff_id() is not null)$p$;
    execute $p$create policy hub_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'hub-files' and (public.is_manager() or owner_id = auth.uid()::text))$p$;
  end if;
end
$$;
