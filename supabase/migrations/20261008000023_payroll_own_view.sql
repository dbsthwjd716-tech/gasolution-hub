-- 본인 급여 보기: 직원은 마감(금액 확정)된 달의 본인 급여만 읽을 수 있음
--   작성 중인 달은 숫자가 바뀌므로 대표·팀장만. 다른 사람 급여·설정·구간표는 그대로 대표·팀장만
create or replace function public.payroll_month_closed(m date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payroll_months where month = m and status = 'closed')
$$;
grant execute on function public.payroll_month_closed(date) to authenticated;

create policy payroll_entries_own_select on public.payroll_entries for select to authenticated
  using (staff_id = public.my_staff_id() and public.payroll_month_closed(month));
