-- 예전 인입 CRM(gasolution-lead-crm) 문의를 통합 시스템으로 옮기기
--   * 대표·팀장만 실행. 예전 번호(source_ref)로 이미 옮긴 문의는 건너뜀 → 여러 번 눌러도 중복 없음 (새로 생긴 문의만 추가)
--   * 담당: 이름이 같은 직원에 연결. "윤소정>박주용"처럼 바뀐 기록은 마지막 사람으로 연결하고 원문은 '예전 담당 기록'에 남김
--     통합 시스템에 없는 퇴사 직원 이름은 퇴사 직원(로그인 없음)으로 만들어 연결
--   * 상담 기록·상태 변경 이력도 함께 옮김. 예상 계약금액·계약금액·실패 사유는 메모 끝에 붙임

create or replace function public.import_legacy_leads(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l jsonb; a jsonb;
  new_id uuid; sid uuid; cid uuid;
  owner_raw text; owner_last text; extra text;
  inserted int := 0; skipped int := 0; acts int := 0;
  created_staff text[] := '{}';
  map jsonb := '{}'::jsonb;  -- 예전 문의 번호 → 새 문의 번호 (이번에 새로 넣은 것만)
begin
  if not public.is_manager() then raise exception '대표·팀장만 옮길 수 있습니다'; end if;

  for l in select * from jsonb_array_elements(coalesce(payload->'leads', '[]'::jsonb)) loop
    if exists (select 1 from public.leads where source_ref = 'crm:' || (l->>'id')) then
      skipped := skipped + 1;
      continue;
    end if;

    -- 담당 이름 정리: 화살표·꺾쇠로 이어진 기록은 마지막 이름
    owner_raw := nullif(trim(l->>'owner'), '');
    owner_last := nullif(trim(regexp_replace(coalesce(owner_raw, ''), '^.*(→|>)', '')), '');
    sid := null;
    if owner_last is not null then
      select id into sid from public.staff where name = owner_last order by is_active desc limit 1;
      if sid is null then
        insert into public.staff(name, role, is_active) values (owner_last, 'staff', false) returning id into sid;
        created_staff := created_staff || owner_last;
      end if;
    end if;
    cid := null;
    if nullif(l->>'created_by', '') is not null then
      select id into cid from public.staff where name = l->>'created_by' order by is_active desc limit 1;
    end if;

    extra := concat_ws(' / ',
      case when nullif(l->>'expected_contract_amount', '') is not null then '예상 계약금액 ' || to_char((l->>'expected_contract_amount')::numeric, 'FM999,999,999,999') || '원' end,
      case when nullif(l->>'contract_amount', '') is not null then '계약금액 ' || to_char((l->>'contract_amount')::numeric, 'FM999,999,999,999') || '원' end,
      case when nullif(l->>'failure_reason', '') is not null then '실패 사유: ' || (l->>'failure_reason') end);

    insert into public.leads(inquiry_at, company_name, contact_name, phone, monthly_budget, source, media, staff_id, status,
                             inquiry_content, memo, legacy_owner, source_ref)
    values (
      coalesce((l->>'inquiry_at')::timestamptz, (l->>'created_at')::timestamptz, now()),
      coalesce(nullif(trim(l->>'company_name'), ''), '(업체명 없음)'),
      nullif(l->>'contact_name', ''),
      nullif(l->>'phone', ''),
      round(nullif(l->>'monthly_budget', '')::numeric)::bigint,
      nullif(l->>'source', ''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(l->'media', '[]'::jsonb)) x), '{}'),
      sid,
      coalesce(nullif(l->>'status', ''), '연락 전'),
      nullif(l->>'inquiry_content', ''),
      nullif(concat_ws(E'\n', nullif(l->>'memo', ''), case when extra <> '' then '[예전 CRM] ' || extra end), ''),
      case when owner_raw is not null and owner_raw is distinct from owner_last then owner_raw end,
      'crm:' || (l->>'id'))
    returning id into new_id;
    -- 등록한 사람은 예전 기록대로 (옮긴 사람으로 남지 않게)
    update public.leads set created_by = cid where id = new_id;
    map := map || jsonb_build_object(l->>'id', new_id);
    inserted := inserted + 1;
  end loop;

  -- 상담 기록 (새로 넣은 문의 것만)
  for a in select * from jsonb_array_elements(coalesce(payload->'logs', '[]'::jsonb)) loop
    new_id := (map->>(a->>'lead_id'))::uuid;
    continue when new_id is null or nullif(trim(a->>'content'), '') is null;
    insert into public.lead_activities(lead_id, activity_type, occurred_at, content, actor_id)
    values (new_id,
            case when a->>'type' in ('전화','문자','카카오톡','이메일','미팅','제안서','기타') then a->>'type' else '기타' end,
            coalesce((a->>'at')::timestamptz, now()), a->>'content',
            (select id from public.staff where name = a->>'by' order by is_active desc limit 1));
    acts := acts + 1;
  end loop;

  -- 상태 변경 이력
  for a in select * from jsonb_array_elements(coalesce(payload->'history', '[]'::jsonb)) loop
    new_id := (map->>(a->>'lead_id'))::uuid;
    continue when new_id is null or nullif(a->>'new', '') is null;
    insert into public.lead_activities(lead_id, activity_type, occurred_at, content, actor_id)
    values (new_id,
            case when nullif(a->>'old', '') is null then '등록' else '상태 변경' end,
            coalesce((a->>'at')::timestamptz, now()),
            case when nullif(a->>'old', '') is null then '문의 등록 (' || (a->>'new') || ')' else (a->>'old') || ' → ' || (a->>'new') end,
            (select id from public.staff where name = a->>'by' order by is_active desc limit 1));
    acts := acts + 1;
  end loop;

  -- 마지막 연락 시각은 예전 기록 그대로
  update public.leads le set last_contact_at = coalesce((x->>'last_contact_at')::timestamptz, le.last_contact_at)
    from jsonb_array_elements(coalesce(payload->'leads', '[]'::jsonb)) x
   where le.source_ref = 'crm:' || (x->>'id') and (map ? (x->>'id'));

  return jsonb_build_object('inserted', inserted, 'skipped', skipped, 'activities', acts, 'created_staff', to_jsonb(created_staff));
end
$$;
revoke execute on function public.import_legacy_leads(jsonb) from public, anon;
grant execute on function public.import_legacy_leads(jsonb) to authenticated;
