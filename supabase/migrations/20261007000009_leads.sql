-- 4단계: 인입 CRM (광고 문의 → 상담 → 계약)
--   * 문의 1건 = leads. 담당은 직원 표(staff)와 연결 (이름 글자로 연결하던 예전 방식의 문제 해결)
--   * 상담 기록·상태 변경·담당 변경이 모두 lead_activities에 시간순으로 남음 (상태·담당 변경은 자동 기록)
--   * 모든 직원이 문의를 등록하고 상담 기록을 남길 수 있음. 담당 지정·변경, 삭제는 대표·팀장
--   * 연락처는 숫자만 따로 저장해서 010-1234-5678 / 01012345678 어느 쪽으로도 찾고 중복을 알 수 있음

create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  inquiry_at       timestamptz not null,
  company_name     text not null check (length(trim(company_name)) > 0),
  contact_name     text,
  phone            text,
  phone_digits     text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  monthly_budget   bigint check (monthly_budget is null or monthly_budget >= 0),
  source           text,           -- 유입경로: 네이버, SNS_DB, 톡톡, 전화, 지인소개, 메일, 기타 (예전 값도 허용)
  media            text[] not null default '{}',
  staff_id         uuid references public.staff(id),     -- 담당
  status           text not null default '연락 전'
                   check (status in ('연락 전','연락 시도','상담중','제안/견적','검토중','계약완료','계약실패','보류','종료','스팸')),
  inquiry_content  text,
  memo             text,
  next_contact_on  date,           -- 다음 연락 예정일 (있으면 이 날짜 기준으로 '연락 필요' 표시)
  last_contact_at  timestamptz,    -- 마지막 상담 기록 시각 (자동)
  client_id        uuid references public.clients(id),   -- 거래처로 연결된 경우
  legacy_owner     text,           -- 예전 CRM에서 옮긴 담당 이름 기록 (예: "A → B")
  source_ref       text unique,    -- 예전 CRM에서 옮길 때의 원래 번호 (다시 옮겨도 중복 안 생김)
  created_by       uuid references public.staff(id),
  updated_by       uuid references public.staff(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.leads is '광고 문의(인입). 상담 → 제안 → 계약까지 진행 상태 관리';
create index leads_inquiry_idx on public.leads(inquiry_at desc);
create index leads_staff_idx on public.leads(staff_id);
create index leads_client_idx on public.leads(client_id);
create index leads_phone_idx on public.leads(phone_digits);
create index leads_created_by_idx on public.leads(created_by);
create index leads_updated_by_idx on public.leads(updated_by);

create table public.lead_activities (
  id            bigint generated always as identity primary key,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  activity_type text not null
                check (activity_type in ('전화','문자','카카오톡','이메일','미팅','제안서','기타','상태 변경','담당 변경','등록')),
  occurred_at   timestamptz not null default now(),
  content       text not null check (length(trim(content)) > 0),
  actor_id      uuid references public.staff(id),
  created_at    timestamptz not null default now()
);
comment on table public.lead_activities is '문의별 상담 기록과 상태·담당 변경 기록';
create index lead_activities_lead_idx on public.lead_activities(lead_id, occurred_at desc);
create index lead_activities_actor_idx on public.lead_activities(actor_id);

-- 문의를 고칠 수 있나: 대표·팀장 또는 담당자 또는 등록한 사람(담당 지정 전)
create or replace function public.can_edit_lead(sid uuid, creator uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_manager()
      or (sid is not null and sid = public.my_staff_id())
      or (sid is null and creator is not null and creator = public.my_staff_id())
$$;

create or replace function public.leads_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_staff_id();
begin
  if me is not null and not public.is_manager() then
    if tg_op = 'INSERT' and new.staff_id is not null and new.staff_id <> me then
      raise exception '다른 직원에게 담당을 지정하는 것은 대표·팀장만 할 수 있습니다';
    end if;
    if tg_op = 'UPDATE' and new.staff_id is distinct from old.staff_id
       and not (old.staff_id is null and new.staff_id = me) then
      raise exception '담당 변경은 대표·팀장만 할 수 있습니다';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(me, new.updated_by);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(me, new.created_by);
  end if;
  return new;
end
$$;
create trigger leads_before_write before insert or update on public.leads
  for each row execute function public.leads_before_write();

-- 상태·담당이 바뀌면 기록을 자동으로 남김
create or replace function public.leads_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_staff_id();
begin
  if tg_op = 'INSERT' then
    if new.source_ref is null then
      insert into public.lead_activities(lead_id, activity_type, content, actor_id)
      values (new.id, '등록', '문의 등록 (' || new.status || ')', me);
    end if;
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into public.lead_activities(lead_id, activity_type, content, actor_id)
    values (new.id, '상태 변경', old.status || ' → ' || new.status, me);
  end if;
  if new.staff_id is distinct from old.staff_id then
    insert into public.lead_activities(lead_id, activity_type, content, actor_id)
    values (new.id, '담당 변경',
            coalesce((select name from public.staff where id = old.staff_id), '미배정') || ' → ' ||
            coalesce((select name from public.staff where id = new.staff_id), '미배정'), me);
  end if;
  return null;
end
$$;
create trigger leads_after_write after insert or update on public.leads
  for each row execute function public.leads_after_write();

-- 상담 기록이 생기면 마지막 연락 시각을 갱신
create or replace function public.lead_activities_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.activity_type in ('전화','문자','카카오톡','이메일','미팅','제안서','기타') then
    update public.leads set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at)
     where id = new.lead_id;
  end if;
  new.actor_id := coalesce(new.actor_id, public.my_staff_id());
  return new;
end
$$;
create trigger lead_activities_touch before insert on public.lead_activities
  for each row execute function public.lead_activities_touch();

create trigger leads_log after insert or update or delete on public.leads
  for each row execute function public.log_change();

revoke execute on function public.leads_before_write() from public, anon, authenticated;
revoke execute on function public.leads_after_write() from public, anon, authenticated;
revoke execute on function public.lead_activities_touch() from public, anon, authenticated;
revoke execute on function public.can_edit_lead(uuid, uuid) from public, anon;
grant execute on function public.can_edit_lead(uuid, uuid) to authenticated;

-- 목록용 보기: 담당·등록자 이름, 기준일(마지막 연락 또는 문의일)
create view public.leads_view with (security_invoker = true) as
select l.*,
       s.name as staff_name,
       s.is_active as staff_active,
       c.company_name as client_name,
       greatest(l.inquiry_at, coalesce(l.last_contact_at, l.inquiry_at)) as last_touch_at
  from public.leads l
  left join public.staff s on s.id = l.staff_id
  left join public.clients c on c.id = l.client_id;

-- ---------------------------------------------------------------- 보안 규칙
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
revoke all on public.leads, public.lead_activities, public.leads_view from anon;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert on public.lead_activities to authenticated;
revoke update, delete on public.lead_activities from authenticated;
grant select on public.leads_view to authenticated;

create policy leads_select on public.leads for select to authenticated using (public.my_staff_id() is not null);
create policy leads_insert on public.leads for insert to authenticated with check (public.my_staff_id() is not null);
create policy leads_update on public.leads for update to authenticated
  using (public.can_edit_lead(staff_id, created_by) or (staff_id is null and public.my_staff_id() is not null))
  with check (public.can_edit_lead(staff_id, created_by));
create policy leads_delete on public.leads for delete to authenticated using (public.is_manager());

create policy lead_activities_select on public.lead_activities for select to authenticated
  using (public.my_staff_id() is not null);
-- 상담 기록은 직원 누구나 남길 수 있음 (자동 기록 종류는 직접 못 씀)
create policy lead_activities_insert on public.lead_activities for insert to authenticated
  with check (public.my_staff_id() is not null
              and activity_type in ('전화','문자','카카오톡','이메일','미팅','제안서','기타'));
