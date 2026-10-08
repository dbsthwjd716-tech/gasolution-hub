// 오늘의 운영 루틴: 본인 것만, 대표·팀장은 전부
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  let r;
  await expectOk('직원이 본인 루틴 등록', async () => {
    r = (await as('kim', `insert into ops_routines(title, kind, weekdays) values ('보고서 발송','weekly','{1}') returning id`)).rows[0].id;
  });
  await expectBlocked('요일 없는 매주 루틴', () => as('kim', `insert into ops_routines(title, kind) values ('x','weekly')`));
  await expectOk('본인 루틴 완료 체크', () => as('kim', `insert into ops_routine_checks(routine_id, due_date) values ($1,'2026-10-12')`, [r]));
  await expectOk('다른 직원에게는 안 보임', async () => {
    const x = await as('lee', `select * from ops_routines`);
    if (x.rows.length) throw new Error('보임');
  });
  await expectBlocked('다른 직원이 완료 체크', () => as('lee', `insert into ops_routine_checks(routine_id, due_date) values ($1,'2026-10-19')`, [r]));
  await expectOk('팀장은 보고 체크 가능', async () => {
    const x = await as('lead', `select * from ops_routines`);
    if (x.rows.length !== 1) throw new Error('안 보임');
    await as('lead', `insert into ops_routine_checks(routine_id, due_date) values ($1,'2026-10-19')`, [r]);
  });
  return finish();
}
