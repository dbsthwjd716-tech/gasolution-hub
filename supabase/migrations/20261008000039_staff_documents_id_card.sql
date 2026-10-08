-- 직원 서류에 신분증 추가
alter table public.staff_documents drop constraint staff_documents_kind_check;
alter table public.staff_documents add constraint staff_documents_kind_check
  check (kind in ('contract','nda','resignation','certificate','bankbook','resident','id_card','other'));
