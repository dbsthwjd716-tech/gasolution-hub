-- 직원 서류함: 근로계약서·비밀유지서약서·퇴직사유서·자격증·통장사본·주민등록등본·기타
--   대표·팀장: 모든 직원 서류 보기·올리기·지우기 / 직원: 본인 서류만 보기·올리기 (지우기는 대표·팀장)
--   파일은 다른 업무 파일(hub-files)과 따로, 직원만 볼 수 있는 보관함(staff-docs)에 둠
--   서류를 열 때마다 누가 언제 열었는지 남김 (대표·팀장만 봄)

create table public.staff_documents (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id),
  kind         text not null check (kind in ('contract','nda','resignation','certificate','bankbook','resident','other')),
  title        text,
  issued_on    date,
  storage_path text not null unique check (storage_path like staff_id::text || '/%'),
  file_name    text not null,
  mime_type    text,
  file_size    bigint,
  note         text,
  uploaded_by  uuid references public.staff(id) default public.my_staff_id(),
  created_at   timestamptz not null default now()
);
comment on table public.staff_documents is '직원 서류 (대표·팀장 + 본인만)';
create index staff_documents_staff on public.staff_documents (staff_id, kind);

create table public.staff_document_views (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.staff_documents(id) on delete cascade,
  viewed_by   uuid not null references public.staff(id) default public.my_staff_id(),
  viewed_at   timestamptz not null default now()
);
comment on table public.staff_document_views is '직원 서류 열람 기록 (대표·팀장만 봄)';

alter table public.staff_documents enable row level security;
alter table public.staff_document_views enable row level security;

create policy staff_docs_select on public.staff_documents for select to authenticated
  using (public.is_manager() or staff_id = public.my_staff_id());
create policy staff_docs_insert on public.staff_documents for insert to authenticated
  with check ((public.is_manager() or staff_id = public.my_staff_id()) and uploaded_by = public.my_staff_id());
create policy staff_docs_update on public.staff_documents for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy staff_docs_remove on public.staff_documents for delete to authenticated using (public.is_manager());

create policy staff_doc_views_select on public.staff_document_views for select to authenticated using (public.is_manager());
create policy staff_doc_views_insert on public.staff_document_views for insert to authenticated
  with check (viewed_by = public.my_staff_id()
              and exists (select 1 from public.staff_documents d where d.id = document_id and (public.is_manager() or d.staff_id = public.my_staff_id())));

revoke all on public.staff_documents, public.staff_document_views from anon;
grant select, insert, update, delete on public.staff_documents to authenticated;
grant select, insert on public.staff_document_views to authenticated;

create trigger zz_preview_block before insert or update or delete on public.staff_documents
  for each statement execute function public.preview_block();
create trigger zz_preview_block before insert or update or delete on public.staff_document_views
  for each statement execute function public.preview_block();

-- 보관함: 경로 첫 칸 = 직원 id. 시험용 DB에는 storage가 없으므로 있을 때만 만듦
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('staff-docs', 'staff-docs', false, 20971520,
            array['application/pdf','image/png','image/jpeg','image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy staff_docs_files_select on storage.objects for select to authenticated
      using (bucket_id = 'staff-docs' and (public.is_manager() or (storage.foldername(name))[1] = public.my_staff_id()::text))$p$;
    execute $p$create policy staff_docs_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'staff-docs' and public.view_as_id() is null
                  and (public.is_manager() or (storage.foldername(name))[1] = public.my_staff_id()::text))$p$;
    execute $p$create policy staff_docs_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'staff-docs' and public.is_manager())$p$;
  end if;
end
$$;
