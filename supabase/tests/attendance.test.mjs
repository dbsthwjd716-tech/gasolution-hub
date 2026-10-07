// 근태·연차: 출퇴근 판정, 휴가 2단계 결재·취소, 근태 예외, 수정 요청, 잔액, 월차 자동 부여, 예전 기록 옮기기
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const id = async (n) => (await db.query(`select id from staff where name=$1`, [n])).rows[0].id;
  const kim = await id('김직원');
  const lee = await id('이직원');
  const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  await db.exec(`
    insert into company_holidays values ('2026-10-09','한글날');
    insert into staff_hr(staff_id, join_date, work_type, birthday_month) values ('${kim}','2024-01-01','standard',null),('${lee}','2026-05-11','flexible',10);
    update staff_hr set leave_grant_mode='manual' where staff_id='${lee}';
    insert into leave_balances(staff_id, leave_year, granted_leave, adjustment_leave) values ('${kim}',2026,3,0),('${lee}',2026,1,0);
  `);

  console.log('출근·퇴근 판정');
  await expectOk('기본근무 10:05 출근 → 지각, 18:00 퇴근 → 조퇴', async () => {
    await db.query(`select att_clock_in($1, '2026-10-12 10:05+09')`, [kim]);
    await db.query(`select att_clock_in($1, '2026-10-12 11:00+09')`, [kim]); // 두 번 눌러도 처음 시각 유지
    const r = await one(`select * from att_clock_out($1, '2026-10-12 18:00+09')`, [kim]);
    if (!r.is_late || !r.is_early_leave || new Date(r.clock_in).toISOString() !== '2026-10-12T01:05:00.000Z') throw new Error(JSON.stringify(r));
  });
  await expectOk('시차근무 9:30 출근 → 18:30 전 퇴근은 조퇴, 이후는 정상', async () => {
    await db.query(`select att_clock_in($1, '2026-10-12 09:30+09')`, [lee]);
    const r = await one(`select * from att_clock_out($1, '2026-10-12 18:40+09')`, [lee]);
    if (r.is_late || r.is_early_leave) throw new Error(JSON.stringify(r));
    await db.query(`select att_clock_in($1, '2026-10-13 10:10+09')`, [lee]);
    const r2 = await one(`select * from att_clock_out($1, '2026-10-13 18:30+09')`, [lee]);
    if (!r2.is_late || !r2.is_early_leave) throw new Error(JSON.stringify(r2));
  });
  await expectBlocked('공휴일 출근', () => db.query(`select att_clock_in($1, '2026-10-09 10:00+09')`, [kim]));
  await expectBlocked('주말 출근', () => db.query(`select att_clock_in($1, '2026-10-10 10:00+09')`, [kim]));
  await expectBlocked('직원이 남의 출근 처리', () => as('kim', `select clock_in($1)`, [lee]));
  await expectOk('본인 출근 버튼은 동작 (오늘 날짜 기준)', async () => {
    try { await as('kim', `select clock_in()`); } catch (e) { if (!/주말|공휴일/.test(e.message)) throw e; }
  });

  console.log('휴가 신청·결재');
  let L;
  await expectOk('연차 2일 신청 → 주말·공휴일 빼고 일수 계산', async () => {
    L = (await as('kim', `insert into leave_requests(staff_id, leave_type, start_date, end_date) values ($1,'annual','2026-10-08','2026-10-11') returning id, leave_days, deduct_leave`, [kim])).rows[0];
    if (Number(L.leave_days) !== 1 || !L.deduct_leave) throw new Error(JSON.stringify(L)); // 8일(목)만 근무일
  });
  await expectBlocked('겹치는 날짜 신청', () => as('kim', `insert into leave_requests(staff_id, leave_type, start_date, end_date) values ($1,'morning_half','2026-10-08','2026-10-08')`, [kim]));
  await expectBlocked('잔여 연차보다 많이 신청', () => as('kim', `insert into leave_requests(staff_id, leave_type, start_date, end_date) values ($1,'annual','2026-10-19','2026-10-23')`, [kim]));
  await expectBlocked('남의 이름으로 신청', () => as('kim', `insert into leave_requests(staff_id, leave_type, start_date, end_date) values ($1,'annual','2026-10-19','2026-10-19')`, [lee]));
  await expectBlocked('승인 상태로 바로 넣기', () => as('kim', `insert into leave_requests(staff_id, leave_type, start_date, end_date, status) values ($1,'annual','2026-10-20','2026-10-20','approved')`, [kim]));
  await expectBlocked('직원이 직접 상태 바꾸기', () => as('kim', `update leave_requests set status='approved' where id=$1`, [L.id]));
  await expectBlocked('직원이 결재', () => as('kim', `select leave_decide($1,'first')`, [L.id]));
  await expectOk('남의 휴가 신청은 안 보임', async () => {
    const r = await as('lee', `select * from leave_requests`);
    if (r.rows.length) throw new Error('보임');
  });
  await expectBlocked('1차 없이 최종 승인', () => as('ceo', `select leave_decide($1,'final')`, [L.id]));
  await expectOk('팀장 1차 → 대표 최종 → 그날 연차 근태가 생기고 출근 막힘', async () => {
    await as('lead', `select leave_decide($1,'first')`, [L.id]);
    await as('ceo', `select leave_decide($1,'final')`, [L.id]);
    const r = await one(`select attendance_status from attendance_records where staff_id=$1 and work_date='2026-10-08'`, [kim]);
    if (r?.attendance_status !== 'annual_leave') throw new Error(JSON.stringify(r));
    try { await db.query(`select att_clock_in($1, '2026-10-08 10:00+09')`, [kim]); throw new Error('출근됨'); } catch (e) { if (e.message === '출근됨') throw e; }
  });
  await expectOk('연차 현황: 직원은 본인 것만, 남은 연차 = 3 − 1', async () => {
    const r = await as('kim', `select * from leave_summary(2026)`);
    if (r.rows.length !== 1 || Number(r.rows[0].remaining) !== 2) throw new Error(JSON.stringify(r.rows));
    const all = await as('lead', `select * from leave_summary(2026)`);
    if (all.rows.length < 4) throw new Error('대표·팀장은 전체가 보여야 함');
  });
  await expectOk('승인된 연차 취소: 요청 → 1차 → 최종 → 근태 지워지고 연차 복구', async () => {
    await as('kim', `select leave_cancel_request($1,'일정 변경')`, [L.id]);
    await as('lead', `select leave_cancel_decide($1,'first')`, [L.id]);
    await as('ceo', `select leave_cancel_decide($1,'final')`, [L.id]);
    const r = await one(`select status, cancel_status from leave_requests where id=$1`, [L.id]);
    const c = await one(`select count(*)::int n from attendance_records where leave_request_id=$1`, [L.id]);
    if (r.status !== 'cancelled' || r.cancel_status || c.n) throw new Error(JSON.stringify([r, c]));
  });
  await expectOk('오전반차 승인 후 15:10 출근은 지각, 14:50은 정상', async () => {
    const h = (await as('kim', `insert into leave_requests(staff_id, leave_type, start_date, end_date) values ($1,'morning_half','2026-10-14','2026-10-14') returning id, leave_days`, [kim])).rows[0];
    if (Number(h.leave_days) !== 0.5) throw new Error('반차 0.5일이 아님');
    await as('lead', `select leave_decide($1,'first')`, [h.id]);
    await as('lead', `select leave_decide($1,'final')`, [h.id]);
    const r = await one(`select * from att_clock_in($1, '2026-10-14 15:10+09')`, [kim]);
    if (!r.is_late || r.attendance_status !== 'morning_half') throw new Error(JSON.stringify(r));
  });
  await expectOk('포상휴가는 승인할 때 연차 차감 안 함을 고를 수 있음', async () => {
    const h = (await as('lee', `insert into leave_requests(staff_id, leave_type, start_date, end_date) values ($1,'reward','2026-10-20','2026-10-21') returning id`, [lee])).rows[0];
    await as('lead', `select leave_decide($1,'first',false)`, [h.id]);
    const r = (await as('ceo', `select (leave_decide($1,'final')).deduct_leave`, [h.id])).rows[0];
    if (r.deduct_leave !== false) throw new Error(JSON.stringify(r));
  });
  await expectOk('결재 전 신청은 본인이 거둬들임', async () => {
    const h = (await as('kim', `insert into leave_requests(staff_id, leave_type, start_date, end_date) values ($1,'afternoon_half','2026-10-16','2026-10-16') returning id`, [kim])).rows[0];
    await as('kim', `select leave_withdraw($1)`, [h.id]);
  });

  console.log('근태 예외');
  await expectOk('종일 기타 근태 승인 → 근태 기록 자동 생성', async () => {
    const e = (await as('kim', `insert into attendance_exceptions(staff_id, work_date, exception_type, note) values ($1,'2026-10-15','other','예비군 훈련') returning id`, [kim])).rows[0];
    await as('lead', `select attendance_exception_decide($1,'approve')`, [e.id]);
    const r = await one(`select attendance_status from attendance_records where attendance_exception_id=$1`, [e.id]);
    if (r?.attendance_status !== 'other') throw new Error('기록 없음');
  });
  await expectBlocked('직원이 승인 상태로 예외 넣기', () => as('kim', `insert into attendance_exceptions(staff_id, work_date, exception_type, note, status) values ($1,'2026-10-22','other','x','approved')`, [kim]));
  await expectBlocked('미팅 장소 없이 신청', () => as('kim', `insert into attendance_exceptions(staff_id, work_date, exception_type, note, start_time) values ($1,'2026-10-22','meeting','광고 미팅','14:00')`, [kim]));
  await expectBlocked('생일 정보 없는 직원 생일 조기퇴근', () => as('kim', `insert into attendance_exceptions(staff_id, work_date, exception_type) values ($1,'2026-10-22','birthday_early_leave')`, [kim]));
  await expectOk('생일 조기퇴근: 16시로 고정, 16:10 퇴근은 정상', async () => {
    const e = (await as('lee', `insert into attendance_exceptions(staff_id, work_date, exception_type) values ($1,'2026-10-22','birthday_early_leave') returning id, approved_leave_time`, [lee])).rows[0];
    if (e.approved_leave_time !== '16:00:00') throw new Error(e.approved_leave_time);
    await as('ceo', `select attendance_exception_decide($1,'approve')`, [e.id]);
    await db.query(`select att_clock_in($1, '2026-10-22 09:50+09')`, [lee]);
    const r = await one(`select * from att_clock_out($1, '2026-10-22 16:10+09')`, [lee]);
    if (r.is_early_leave || r.attendance_status !== 'birthday_early_leave') throw new Error(JSON.stringify(r));
  });
  await expectBlocked('생일 조기퇴근 1년에 두 번', () => as('lee', `insert into attendance_exceptions(staff_id, work_date, exception_type) values ($1,'2026-10-27','birthday_early_leave')`, [lee]));

  console.log('근태 수정');
  await expectOk('직원 수정 요청 → 팀장 승인 → 기록 바뀌고 이력 남음, 지각 다시 판정', async () => {
    const rec = await one(`select id from attendance_records where staff_id=$1 and work_date='2026-10-12'`, [kim]);
    const c = (await as('kim', `select (attendance_correction_request($1, '2026-10-12 09:55+09', '2026-10-12 19:05+09', '버튼을 늦게 눌렀습니다')).id`, [rec.id])).rows[0];
    await as('lead', `select attendance_correction_decide($1,'approved')`, [c.id]);
    const r = await one(`select is_late, is_early_leave from attendance_records where id=$1`, [rec.id]);
    const h = await one(`select count(*)::int n from attendance_record_history where attendance_record_id=$1`, [rec.id]);
    if (r.is_late || r.is_early_leave || h.n !== 1) throw new Error(JSON.stringify([r, h]));
  });
  await expectBlocked('남의 기록 수정 요청', async () => {
    const rec = await one(`select id from attendance_records where staff_id=$1 and work_date='2026-10-12'`, [lee]);
    return as('kim', `select attendance_correction_request($1, null, null, '잘못')`, [rec.id]);
  });
  await expectBlocked('직원이 근태 기록 직접 고치기', () => as('kim', `select attendance_record_save($1,'2026-10-12',null,null,null,'x')`, [kim]));
  await expectOk('팀장이 출근 기록 없는 날 기록 추가', () => as('lead', `select attendance_record_save($1,'2026-10-13','2026-10-13 09:58+09','2026-10-13 19:00+09',null,'출근 버튼 누락')`, [kim]));
  await expectBlocked('휴가로 만들어진 기록 직접 고치기', async () => {
    const r = await one(`select work_date from attendance_records where staff_id=$1 and attendance_status='other'`, [kim]);
    return as('lead', `select attendance_record_save($1,$2,'2026-10-15 10:00+09',null,null,'x')`, [kim, r.work_date]);
  });

  console.log('달력·보기 권한');
  await expectOk('직원 달력: 남의 승인 휴가·공휴일은 보이고 출퇴근 기록은 안 보임', async () => {
    const r = await as('kim', `select * from att_calendar('2026-10-01','2026-10-31')`);
    const src = new Set(r.rows.map((x) => x.source));
    if (!src.has('holiday') || !r.rows.some((x) => x.staff_id === lee && x.source === 'leave') || src.has('attendance')) throw new Error([...src].join());
    const m = await as('lead', `select * from att_calendar('2026-10-01','2026-10-31') where source='attendance'`);
    if (!m.rows.length) throw new Error('대표·팀장에게 출퇴근 기록이 안 보임');
  });
  await expectOk('인사 정보(생일 등)는 본인 것만', async () => {
    const r = await as('kim', `select * from staff_hr`);
    if (r.rows.length !== 1 || r.rows[0].staff_id !== kim) throw new Error(JSON.stringify(r.rows));
  });
  await expectBlocked('직원이 공휴일 추가', () => as('kim', `insert into company_holidays values ('2026-12-31','종무식')`));

  console.log('설정·잔액·월차');
  await expectBlocked('직원이 근무 설정 고치기', () => as('kim', `select work_setting_set('standard_clock_in','09:00')`));
  await expectBlocked('시간 형식이 아닌 설정값', () => as('lead', `select work_setting_set('standard_clock_in','아홉시')`));
  await expectOk('팀장이 출근시간 9:30으로 → 이력 남음', async () => {
    await as('lead', `select work_setting_set('standard_clock_in','9:30')`);
    const r = await one(`select setting_value from work_settings where setting_key='standard_clock_in'`);
    const h = await one(`select count(*)::int n from work_setting_history`);
    if (r.setting_value !== '09:30' || h.n !== 1) throw new Error(JSON.stringify([r, h]));
    await as('lead', `select work_setting_set('standard_clock_in','10:00')`);
  });
  await expectBlocked('이미 쓴 연차보다 적게 설정', () => as('lead', `select leave_balance_set($1,2026,0,0)`, [kim]));
  await expectOk('연차 조정 → 이력', async () => {
    await as('lead', `select leave_balance_set($1,2026,3,1,'포상')`, [kim]);
    const h = await one(`select new_adjustment_leave from leave_balance_history where staff_id=$1`, [kim]);
    if (Number(h.new_adjustment_leave) !== 1) throw new Error(JSON.stringify(h));
  });
  await expectOk('1년 미만 월차: 입사 다음 달 1일은 건너뛰고, 그다음 달부터 1일씩, 두 번 돌려도 한 번만', async () => {
    const a = await db.query(`select * from auto_grant_annual_leave('2026-06-01')`);
    const b = await db.query(`select * from auto_grant_annual_leave('2026-07-01')`);
    await db.query(`select * from auto_grant_annual_leave('2026-07-01')`);
    const bal = await one(`select granted_leave from leave_balances where staff_id=$1 and leave_year=2026`, [lee]);
    if (a.rows.some((x) => x.staff_id === lee) || !b.rows.some((x) => x.staff_id === lee) || Number(bal.granted_leave) !== 2) throw new Error(JSON.stringify([a.rows, b.rows, bal]));
  });
  await expectOk('회계연도 방식: 1월 1일 15일', async () => {
    await db.query(`select * from auto_grant_annual_leave('2027-01-01')`);
    const r = await one(`select granted_leave from leave_balances where staff_id=$1 and leave_year=2027`, [kim]);
    if (Number(r?.granted_leave) !== 15) throw new Error(JSON.stringify(r));
  });
  await expectBlocked('직원이 자동 부여 실행', () => as('kim', `select * from auto_grant_annual_leave('2026-08-01')`));

  console.log('예전 대시보드 기록 옮기기');
  const payload = {
    employees: [
      { id: 1, name: '김직원', join_date: '2023-06-01', birthday_month: 8, birthday_day: 17, work_type: 'standard', employment_status: 'active', role: 'admin', leave_grant_mode: 'accounting_auto' },
      { id: 6, name: '박퇴사', join_date: '2026-05-11', work_type: 'standard', employment_status: 'resigned', role: 'employee', leave_grant_mode: 'manual' },
    ],
    settings: { lunch_end: '13:00' },
    holidays: [{ date: '2026-12-25', name: '기독탄신일' }],
    balances: [{ employee_id: 6, leave_year: 2026, granted_leave: 3, adjustment_leave: 0, note: '수동' }],
    grants: [{ employee_id: 6, grant_date: '2026-07-01', granted_days: 1, note: '월차' }],
    leaves: [
      { id: 42, employee_id: 1, leave_type: 'reward', start_date: '2026-09-29', end_date: '2026-09-29', leave_days: 1, deduct_leave: true, status: 'approved', approved_by: 1, approved_at: '2026-09-15T06:24:48Z', created_at: '2026-09-15T06:24:27Z' },
      { id: 36, employee_id: 1, leave_type: 'annual', start_date: '2026-09-15', end_date: '2026-09-15', leave_days: 1, deduct_leave: true, status: 'rejected', resubmitted_from_id: 33, created_at: '2026-09-15T04:41:32Z' },
      { id: 33, employee_id: 1, leave_type: 'annual', start_date: '2026-09-15', end_date: '2026-09-15', leave_days: 1, deduct_leave: true, status: 'rejected', created_at: '2026-09-15T03:00:55Z' },
    ],
    exceptions: [{ id: 4, employee_id: 6, work_date: '2026-09-18', exception_type: 'other', note: '예비군', status: 'approved', approved_by: 1, created_at: '2026-09-15T05:34:14Z' }],
    records: [
      { id: 26, employee_id: 1, work_date: '2026-09-29', attendance_status: 'reward_leave', is_late: false, is_early_leave: false, note: '승인된 포상휴가', leave_request_id: 42, created_at: '2026-09-15T06:24:49Z', updated_at: '2026-09-15T06:24:49Z' },
      { id: 25, employee_id: 6, work_date: '2026-09-15', clock_in: '2026-09-15T06:20:36Z', clock_out: '2026-09-15T10:00:00Z', attendance_status: 'normal', is_late: true, is_early_leave: true, created_at: '2026-09-15T06:20:36Z', updated_at: '2026-09-15T09:21:33Z' },
      { id: 99, employee_id: 1, work_date: '2026-10-12', clock_in: '2026-10-12T00:50:00Z', attendance_status: 'normal', is_late: false, is_early_leave: false, created_at: '2026-10-12T00:50:00Z', updated_at: '2026-10-12T00:50:00Z' },
    ],
    corrections: [{ id: 1, attendance_record_id: 25, employee_id: 6, work_date: '2026-09-15', requested_clock_in: '2026-09-15T06:20:36Z', requested_clock_out: '2026-09-15T10:00:00Z', reason: '퇴근 버튼 오류', status: 'approved', processed_by: 1, processed_at: '2026-09-15T09:21:33Z', created_at: '2026-09-15T09:18:52Z' }],
    record_history: [{ id: 3, attendance_record_id: 25, employee_id: 6, work_date: '2026-09-15', new_clock_out: '2026-09-15T10:00:00Z', change_reason: '수정', changed_by: 1, created_at: '2026-09-15T09:21:33Z' }],
    balance_history: [],
  };
  await expectBlocked('직원이 옮기기 실행', () => as('kim', `select import_legacy_attendance($1)`, [JSON.stringify(payload)]));
  await expectOk('옮기기: 이름으로 연결, 없는 퇴사 직원은 새로 만듦, 같은 날 새 기록이 있으면 그쪽 유지', async () => {
    const r = (await as('lead', `select import_legacy_attendance($1) j`, [JSON.stringify(payload)])).rows[0].j;
    if (r.records !== 2 || r.skipped_records !== 1 || r.created_staff[0] !== '박퇴사' || r.leaves !== 3) throw new Error(JSON.stringify(r));
    const s = await one(`select legacy_dashboard_employee_id from staff where id=$1`, [kim]);
    const hr = await one(`select birthday_month from staff_hr where staff_id=$1`, [kim]);
    const rs = await one(`select r.resubmitted_from_id = p.id ok from leave_requests r join leave_requests p on p.legacy_id=33 where r.legacy_id=36`);
    const lk = await one(`select l.legacy_id from attendance_records a join leave_requests l on l.id=a.leave_request_id where a.legacy_id=26`);
    const cor = await one(`select count(*)::int n from attendance_correction_requests where legacy_id=1`);
    if (Number(s.legacy_dashboard_employee_id) !== 1 || hr.birthday_month !== 8 || !rs.ok || Number(lk.legacy_id) !== 42 || cor.n !== 1) throw new Error('연결 오류');
  });
  await expectOk('다시 옮겨도 중복 없음, 예전에서 바뀐 상태 반영, 지워진 기록은 지움', async () => {
    const p2 = structuredClone(payload);
    p2.leaves[0].status = 'cancelled';
    p2.records = p2.records.filter((x) => x.id !== 26);
    await as('lead', `select import_legacy_attendance($1)`, [JSON.stringify(p2)]);
    const c = await one(`select (select count(*)::int from leave_requests where legacy_id is not null) l, (select count(*)::int from attendance_records where legacy_id is not null) r,
                           (select status from leave_requests where legacy_id=42) s, (select count(*)::int from staff where name='박퇴사') p`);
    if (c.l !== 3 || c.r !== 1 || c.s !== 'cancelled' || c.p !== 1) throw new Error(JSON.stringify(c));
  });
  await expectOk('옮긴 뒤에도 자동 검사는 다시 켜져 있음', async () => {
    try {
      await as('kim', `insert into leave_requests(staff_id, leave_type, start_date, end_date) values ($1,'annual','2026-11-02','2026-11-06')`, [kim]);
      throw new Error('잔액 검사가 꺼져 있음');
    } catch (e) { if (e.message === '잔액 검사가 꺼져 있음') throw e; }
  });
  return finish();
}
