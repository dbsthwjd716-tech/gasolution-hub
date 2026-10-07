-- 협력사 견적서(사용 내역) 목록
--   * 협력사가 매월·매주 보내 주는 "이만큼 썼다" 견적서를 협력사별로 올려 둠
--   * 견적서마다: 협력사에 입금했는지 → (입금한 것만) 광고주에게 세금계산서를 발행했는지 체크
--   * 견적서에 바이럴 건을 연결하면, 입금 체크 시 그 건들이 '협력사 결제 완료'로,
--     세금계산서 체크 시 그 건들이 '세금계산서 발행'으로 같이 바뀜
--   * 금액이 협력사에 주는 돈(공급가)이므로 공급가를 볼 수 있는 사람(대표·팀장·서진원)만 보고 다룸

create table public.viral_partner_statements (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.viral_partners(id),
  period_start    date not null,
  period_end      date not null,
  title           text,                                   -- 예: 10월 1주차
  amount          bigint not null default 0 check (amount >= 0),  -- 협력사 견적 금액(VAT 포함)
  paid            boolean not null default false,          -- 협력사에 입금
  paid_on         date,
  invoice_done    boolean not null default false,          -- 광고주에게 세금계산서 발행
  invoice_done_on date,
  memo            text,
  created_by      uuid references public.staff(id) default public.my_staff_id(),
  updated_by      uuid references public.staff(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (period_end >= period_start),
  check (not invoice_done or paid)
);
comment on table public.viral_partner_statements is '협력사가 보낸 사용 내역 견적서. 입금 → 광고주 세금계산서 발행 순서로 체크';
create index viral_statements_partner_idx on public.viral_partner_statements(partner_id, period_start desc);

create table public.viral_partner_statement_files (
  id            uuid primary key default gen_random_uuid(),
  statement_id  uuid not null references public.viral_partner_statements(id) on delete cascade,
  file_name     text not null,
  storage_path  text not null,
  mime_type     text,
  file_size     bigint,
  uploaded_by   uuid references public.staff(id) default public.my_staff_id(),
  created_at    timestamptz not null default now()
);
create index viral_statement_files_idx on public.viral_partner_statement_files(statement_id);

alter table public.viral_orders add column partner_statement_id uuid references public.viral_partner_statements(id) on delete set null;
create index viral_orders_statement_idx on public.viral_orders(partner_statement_id);
grant select (partner_statement_id) on public.viral_orders to authenticated;

-- ---------------------------------------------------------------- 입금·발행 체크 시 날짜 채우고, 연결된 바이럴 건도 같이 바꿈
create or replace function public.viral_statements_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.invoice_done and not new.paid then
    raise exception '협력사 입금을 먼저 체크해야 세금계산서 발행을 체크할 수 있습니다';
  end if;
  if new.paid and new.paid_on is null then new.paid_on := (now() at time zone 'Asia/Seoul')::date; end if;
  if not new.paid then new.paid_on := null; end if;
  if new.invoice_done and new.invoice_done_on is null then new.invoice_done_on := (now() at time zone 'Asia/Seoul')::date; end if;
  if not new.invoice_done then new.invoice_done_on := null; end if;
  new.updated_by := coalesce(public.my_staff_id(), new.updated_by);
  new.updated_at := now();
  return new;
end
$$;
create trigger viral_statements_before_write before insert or update on public.viral_partner_statements
  for each row execute function public.viral_statements_before_write();

create or replace function public.viral_statements_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.paid and (tg_op = 'INSERT' or not old.paid) then
    update public.viral_orders set partner_paid = true where partner_statement_id = new.id and not partner_paid;
  end if;
  if new.invoice_done and (tg_op = 'INSERT' or not old.invoice_done) then
    update public.viral_orders set invoice_status = 'issued', invoice_issued_at = coalesce(invoice_issued_at, new.invoice_done_on)
     where partner_statement_id = new.id and invoice_status in ('not_issued', 'requested');
  end if;
  return null;
end
$$;
create trigger viral_statements_after_write after insert or update on public.viral_partner_statements
  for each row execute function public.viral_statements_after_write();
revoke execute on function public.viral_statements_before_write() from public, anon, authenticated;
revoke execute on function public.viral_statements_after_write() from public, anon, authenticated;

-- 바이럴 건을 견적서에 연결·해제 (담당자가 달라도 권한 있는 사람이면 가능, 같은 협력사 건만)
create or replace function public.viral_statement_link(sid uuid, order_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare st public.viral_partner_statements; n integer;
begin
  if not public.can_view_cost() then raise exception '권한이 없습니다'; end if;
  select * into st from public.viral_partner_statements where id = sid;
  if st.id is null then raise exception '견적서를 찾을 수 없습니다'; end if;
  update public.viral_orders set partner_statement_id = null
   where partner_statement_id = sid and not (id = any(coalesce(order_ids, '{}')));
  update public.viral_orders o
     set partner_statement_id = sid,
         partner_paid = o.partner_paid or st.paid,
         invoice_status = case when st.invoice_done and o.invoice_status in ('not_issued', 'requested') then 'issued' else o.invoice_status end,
         invoice_issued_at = case when st.invoice_done and o.invoice_status in ('not_issued', 'requested') then coalesce(o.invoice_issued_at, st.invoice_done_on) else o.invoice_issued_at end
   where o.id = any(coalesce(order_ids, '{}')) and o.partner_id = st.partner_id;
  get diagnostics n = row_count;
  return n;
end
$$;
revoke execute on function public.viral_statement_link(uuid, uuid[]) from public, anon;
grant execute on function public.viral_statement_link(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------- 권한
alter table public.viral_partner_statements enable row level security;
alter table public.viral_partner_statement_files enable row level security;

create policy viral_statements_select on public.viral_partner_statements for select to authenticated using (public.can_view_cost());
create policy viral_statements_insert on public.viral_partner_statements for insert to authenticated with check (public.can_view_cost());
create policy viral_statements_update on public.viral_partner_statements for update to authenticated
  using (public.can_view_cost()) with check (public.can_view_cost());
create policy viral_statements_delete on public.viral_partner_statements for delete to authenticated using (public.is_manager());

create policy viral_statement_files_select on public.viral_partner_statement_files for select to authenticated using (public.can_view_cost());
create policy viral_statement_files_insert on public.viral_partner_statement_files for insert to authenticated with check (public.can_view_cost());
create policy viral_statement_files_delete on public.viral_partner_statement_files for delete to authenticated
  using (public.is_manager() or (public.can_view_cost() and uploaded_by = public.my_staff_id()));

revoke all on public.viral_partner_statements, public.viral_partner_statement_files from anon;
grant select, insert, update, delete on public.viral_partner_statements, public.viral_partner_statement_files to authenticated;

create trigger viral_statements_log after insert or update or delete on public.viral_partner_statements
  for each row execute function public.log_change();

-- 협력사 견적서는 엑셀로 오는 경우가 많아 보관함에 엑셀·CSV도 허용
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp',
             'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv']
     where id = 'hub-files';
  end if;
end
$$;
