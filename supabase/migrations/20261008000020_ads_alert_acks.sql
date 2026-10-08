-- 오늘의 운영 알림 '확인' 기록 (광고 운영 1차: 데이터는 예전 대시보드에서 읽고, 확인 처리만 여기 저장)
--   alert_key = 종류:광고주번호:날짜. 오늘 날짜 알림만 확인 처리할 수 있음
create table public.ads_alert_acks (
  alert_key   text primary key,
  ack_date    date not null default (timezone('Asia/Seoul', now()))::date,
  customer_id text,
  manager     text,
  staff_id    uuid references public.staff(id) on delete set null default public.my_staff_id(),
  created_at  timestamptz not null default now(),
  check (alert_key like '%:' || ack_date::text)
);
alter table public.ads_alert_acks enable row level security;
-- 대표·팀장은 전체, 직원은 본인 담당 광고주(manager = 본인 이름) 알림만
create policy ads_alert_acks_select on public.ads_alert_acks for select to authenticated using (public.my_staff_id() is not null);
create policy ads_alert_acks_insert on public.ads_alert_acks for insert to authenticated
  with check (ack_date = (timezone('Asia/Seoul', now()))::date and staff_id = public.my_staff_id()
              and (public.is_manager() or manager = (select name from public.staff where id = public.my_staff_id())));
revoke all on public.ads_alert_acks from anon;
