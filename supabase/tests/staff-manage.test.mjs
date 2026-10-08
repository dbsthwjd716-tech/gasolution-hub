// 직원 관리: 팀장은 일반 직원 추가·퇴사만, 역할·공급가 권한은 대표만
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const kim = (await db.query(`select id from staff where name='김직원'`)).rows[0].id;
  await expectOk('팀장이 일반 직원 추가', () => as('lead', `insert into staff(name,email,role) values ('신입','new@x','staff')`));
  await expectBlocked('팀장이 팀장 역할로 추가', () => as('lead', `insert into staff(name,email,role) values ('팀장2','l2@x','lead')`));
  await expectOk('팀장이 퇴사 처리', async () => {
    const r = await as('lead', `update staff set is_active=false where id=$1 returning id`, [kim]);
    if (!r.rows.length) throw new Error('안 바뀜');
  });
  await expectBlocked('팀장이 공급가 보기 권한 주기', () => as('lead', `update staff set can_view_cost=true where name='이직원'`));
  await expectBlocked('팀장이 직원을 팀장으로', () => as('lead', `update staff set role='lead' where name='이직원'`));
  await expectBlocked('직원이 다른 직원 퇴사 처리', () => as('lee', `update staff set is_active=false where name='신입' returning id`));
  await expectOk('대표는 역할 변경 가능', () => as('ceo', `update staff set role='lead' where name='이직원'`));
  return finish();
}
