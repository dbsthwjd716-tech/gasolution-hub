// 4단계 인입 CRM 시험: 등록, 담당 권한, 자동 기록, 연락처 검색
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const id = async (u) => (await db.query(`select id from staff where name=$1`, [u])).rows[0].id;
  const kim = await id('김직원');
  const lee = await id('이직원');

  console.log('문의 등록');
  const l = await expectOk('김직원이 문의 등록 (담당 없이)', () =>
    as('kim', `insert into leads(inquiry_at,company_name,phone,source,media) values ('2026-10-07 10:00+09','우와해','010-1234-5678','SNS_DB','{메타}') returning id, status, created_by, phone_digits`));
  const lid = l.rows[0].id;
  await expectOk('기본 상태는 연락 전, 연락처 숫자만 따로 저장', async () => {
    const r = l.rows[0];
    if (r.status !== '연락 전' || r.phone_digits !== '01012345678' || r.created_by !== kim) throw new Error(JSON.stringify(r));
  });
  await expectOk('등록 기록이 자동으로 남음', async () => {
    const r = await db.query(`select activity_type from lead_activities where lead_id=$1`, [lid]);
    if (r.rows[0]?.activity_type !== '등록') throw new Error(JSON.stringify(r.rows));
  });
  await expectBlocked('직원이 다른 직원에게 담당 지정', () =>
    as('kim', `insert into leads(inquiry_at,company_name,staff_id) values (now(),'x',$1)`, [lee]));
  await expectBlocked('로그인 안 한 사람이 문의 보기 (예전 CRM은 공개였음)', () => as(null, `select * from leads`));
  await expectBlocked('로그인 안 한 사람이 목록 보기', () => as(null, `select * from leads_view`));

  console.log('담당');
  await expectOk('미배정 문의는 직원이 스스로 담당으로 가져갈 수 있음', () =>
    as('lee', `update leads set staff_id=$2 where id=$1`, [lid, lee]));
  await expectBlocked('담당이 있는 문의를 다른 직원이 가져가기', () =>
    as('kim', `update leads set staff_id=$2 where id=$1`, [lid, kim]));
  await expectBlocked('담당이 아닌 직원이 내용 수정', () => as('kim', `update leads set memo='x' where id=$1`, [lid]));
  await expectOk('팀장이 담당 변경', () => as('lead', `update leads set staff_id=$2 where id=$1`, [lid, kim]));
  await expectOk('담당 변경 기록이 이름으로 남음', async () => {
    const r = await db.query(`select content from lead_activities where lead_id=$1 and activity_type='담당 변경' order by id`, [lid]);
    const s = r.rows.map((x) => x.content).join(' / ');
    if (s !== '미배정 → 이직원 / 이직원 → 김직원') throw new Error(s);
  });

  console.log('상태·상담 기록');
  await expectOk('담당자가 상태 변경 → 기록 자동', async () => {
    await as('kim', `update leads set status='상담중' where id=$1`, [lid]);
    const r = await db.query(`select content from lead_activities where lead_id=$1 and activity_type='상태 변경'`, [lid]);
    if (r.rows[0]?.content !== '연락 전 → 상담중') throw new Error(JSON.stringify(r.rows));
  });
  await expectBlocked('없는 상태값', () => as('kim', `update leads set status='진행중' where id=$1`, [lid]));
  await expectOk('다른 직원도 상담 기록은 남길 수 있음 → 마지막 연락 시각 갱신', async () => {
    await as('lee', `insert into lead_activities(lead_id,activity_type,occurred_at,content) values ($1,'전화','2026-10-08 15:00+09','부재중, 내일 다시')`, [lid]);
    const r = await db.query(`select last_contact_at from leads where id=$1`, [lid]);
    if (!r.rows[0].last_contact_at) throw new Error('갱신 안 됨');
    const a = await db.query(`select s.name from lead_activities a join staff s on s.id=a.actor_id where a.lead_id=$1 and activity_type='전화'`, [lid]);
    if (a.rows[0].name !== '이직원') throw new Error('기록자 ' + a.rows[0].name);
  });
  await expectBlocked('상태 변경 기록을 직접 꾸며 쓰기', () =>
    as('kim', `insert into lead_activities(lead_id,activity_type,content) values ($1,'상태 변경','x')`, [lid]));
  await expectBlocked('상담 기록 고치기', () => as('kim', `update lead_activities set content='x' where lead_id=$1`, [lid]));
  await expectBlocked('상담 기록 지우기', () => as('lead', `delete from lead_activities where lead_id=$1`, [lid]));

  console.log('검색·삭제');
  await expectOk('하이픈 없이 연락처로 찾기', async () => {
    const r = await as('lee', `select id from leads_view where phone_digits like '%' || $1 || '%'`, ['12345678']);
    if (r.rows.length !== 1) throw new Error(String(r.rows.length));
  });
  await expectOk('목록에 담당 이름이 붙음', async () => {
    const r = await as('lee', `select staff_name from leads_view where id=$1`, [lid]);
    if (r.rows[0].staff_name !== '김직원') throw new Error(r.rows[0].staff_name);
  });
  await expectBlocked('직원이 문의 삭제', () => as('kim', `delete from leads where id=$1`, [lid]));
  await expectOk('대표가 문의 삭제 → 기록도 함께 삭제', async () => {
    await as('ceo', `delete from leads where id=$1`, [lid]);
    const r = await db.query(`select count(*)::int n from lead_activities where lead_id=$1`, [lid]);
    if (r.rows[0].n !== 0) throw new Error(String(r.rows[0].n));
  });

  return finish();
}
