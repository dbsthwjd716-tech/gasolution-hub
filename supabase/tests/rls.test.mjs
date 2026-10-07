// 1단계 권한 규칙 시험: 대표·팀장·직원·로그인 안 한 사람이 각각 무엇을 할 수 있는지 확인
import { setup } from './_db.mjs';

export async function run() {
const { db, as, expectOk, expectBlocked, finish } = await setup();

console.log('사업자번호');
await expectOk('지에이솔루션 347-88-02171 검증 통과', async () => {
  const r = await db.query(`select is_valid_business_number(normalize_business_number('347-88-02171')) ok`);
  if (!r.rows[0].ok) throw new Error('false');
});
await expectOk('끝자리 틀린 번호는 거절', async () => {
  const r = await db.query(`select is_valid_business_number('3478802172') ok`);
  if (r.rows[0].ok) throw new Error('true');
});

console.log('거래처 등록·수정');
const a = await expectOk('김직원이 거래처 등록 (하이픈 섞어 입력)', () =>
  as('kim', `insert into clients(company_name,business_number) values ('(주)지에이솔루션','347-88-02171') returning id,business_number,owner_staff_id,is_provisional`));
const clientA = a.rows[0].id;
await expectOk('사업자번호가 숫자 10자리로 정리돼 저장', async () => {
  if (a.rows[0].business_number !== '3478802171') throw new Error(a.rows[0].business_number);
});
await expectOk('등록한 직원이 자동으로 담당자', async () => {
  const r = await db.query(`select name from staff where id=$1`, [a.rows[0].owner_staff_id]);
  if (r.rows[0].name !== '김직원') throw new Error(r.rows[0].name);
});
await expectBlocked('같은 사업자번호 중복 등록', () =>
  as('lee', `insert into clients(company_name,business_number) values ('다른이름','3478802171')`));
await expectBlocked('틀린 사업자번호 등록', () =>
  as('lee', `insert into clients(company_name,business_number) values ('오타','123-45-67890')`));
const b = await expectOk('이직원이 사업자번호 없이 임시 거래처 등록', () =>
  as('lee', `insert into clients(company_name) values ('임시업체') returning id,is_provisional`));
const clientB = b.rows[0].id;
await expectOk('임시 거래처 표시', async () => { if (!b.rows[0].is_provisional) throw new Error('not provisional'); });

await expectOk('이직원도 김직원 거래처를 볼 수 있음', async () => {
  const r = await as('lee', `select count(*)::int n from clients`);
  if (r.rows[0].n !== 2) throw new Error(String(r.rows[0].n));
});
await expectBlocked('이직원이 김직원 거래처 수정', () =>
  as('lee', `update clients set memo='x' where id=$1`, [clientA]));
await expectOk('팀장은 아무 거래처나 수정', async () => {
  const r = await as('lead', `update clients set memo='팀장 메모' where id=$1`, [clientA]);
  if (r.affectedRows !== 1) throw new Error('0건');
});
await expectBlocked('팀장도 거래처 삭제는 못 함', () => as('lead', `delete from clients where id=$1`, [clientB]));

console.log('브랜드·계정·담당자');
const br = await expectOk('김직원이 본인 거래처에 브랜드 추가', () =>
  as('kim', `insert into brands(client_id,name) values ($1,'지에이 브랜드') returning id`, [clientA]));
await expectBlocked('김직원이 남의 거래처에 브랜드 추가', () =>
  as('kim', `insert into brands(client_id,name) values ($1,'몰래') returning id`, [clientB]));
const acc = await expectOk('김직원이 네이버 계정 연결', () =>
  as('kim', `insert into media_accounts(brand_id,platform,external_id,account_name) values ($1,'naver_searchad','1234567','지에이-검색광고') returning id`, [br.rows[0].id]));
await expectBlocked('같은 매체·계정번호 중복 연결', () =>
  as('lead', `insert into media_accounts(brand_id,platform,external_id) values ($1,'naver_searchad','1234567')`, [br.rows[0].id]));
await expectBlocked('직원이 담당자 지정', () =>
  as('kim', `insert into media_account_assignments(media_account_id,staff_id) values ($1,(select id from staff where name='이직원'))`, [acc.rows[0].id]));
await expectOk('팀장이 그 계정 담당을 이직원으로 지정', () =>
  as('lead', `insert into media_account_assignments(media_account_id,staff_id) values ($1,(select id from staff where name='이직원'))`, [acc.rows[0].id]));
await expectOk('계정 담당이 된 이직원은 그 거래처 수정 가능', async () => {
  const r = await as('lee', `update clients set billing_emails='{tax@ga.kr}' where id=$1`, [clientA]);
  if (r.affectedRows !== 1) throw new Error('0건');
});

console.log('다른 이름 목록');
await expectOk('다른 이름 등록', () =>
  as('kim', `insert into name_aliases(client_id,alias,source) values ($1,'지에이 솔루션','viral')`, [clientA]));
await expectBlocked('띄어쓰기·(주)만 다른 같은 이름 중복', () =>
  as('lead', `insert into name_aliases(client_id,alias,source) values ($1,'(주) 지에이솔루션','crm')`, [clientB]));

console.log('직원·변경 기록·외부인');
await expectBlocked('직원이 본인을 대표로 승격', () =>
  as('kim', `update staff set role='ceo' where name='김직원'`));
await expectOk('대표는 직원 역할 변경 가능', async () => {
  const r = await as('ceo', `update staff set role='lead' where name='이직원'`);
  if (r.affectedRows !== 1) throw new Error('0건');
});
await expectOk('변경 기록이 자동으로 쌓임 (팀장 조회)', async () => {
  const r = await as('lead', `select count(*)::int n from change_log where table_name='clients'`);
  if (r.rows[0].n < 3) throw new Error(String(r.rows[0].n));
});
await expectOk('직원은 변경 기록 못 봄', async () => {
  const r = await as('kim', `select count(*)::int n from change_log`);
  if (r.rows[0].n !== 0) throw new Error(String(r.rows[0].n));
});
await expectBlocked('변경 기록을 손으로 지우기', () => as('ceo', `delete from change_log`));
await expectBlocked('로그인 안 한 사람이 거래처 조회', () => as(null, `select * from clients`));
await expectOk('퇴사 처리된 직원은 아무것도 못 봄', async () => {
  await db.exec(`update staff set is_active=false where name='김직원'`);
  const r = await as('kim', `select count(*)::int n from clients`);
  if (r.rows[0].n !== 0) throw new Error(String(r.rows[0].n));
});

return finish();
}
