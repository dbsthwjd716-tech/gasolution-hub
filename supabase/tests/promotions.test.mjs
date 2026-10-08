// 주간 일소진 프로모션: 대표·팀장만 목표 수정, 이력, 마감하면 잠김, 마감 결과는 마감 버튼으로만
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const kim = (await db.query(`select id from staff where name='김직원'`)).rows[0].id;
  let w;
  await expectOk('팀장이 주차 만들고 목표 넣기', async () => {
    w = (await as('lead', `insert into promo_weeks(base_start,base_end,week_start,week_end,team_increment) values ('2026-09-28','2026-10-04','2026-10-05','2026-10-11',105000) returning id`)).rows[0].id;
    await as('lead', `insert into promo_targets(week_id,staff_id,increment,scope) values ($1,$2,60000,'naver')`, [w, kim]);
  });
  await expectOk('직원도 목표는 볼 수 있음', async () => {
    const r = await as('kim', `select * from promo_targets where week_id=$1`, [w]);
    if (r.rows.length !== 1) throw new Error('안 보임');
  });
  await expectBlocked('직원이 목표 고치기', () => as('kim', `update promo_targets set increment=1 where week_id=$1`, [w]));
  await expectBlocked('직원이 주차 만들기', () => as('kim', `insert into promo_weeks(base_start,base_end,week_start,week_end) values ('2026-10-05','2026-10-11','2026-10-12','2026-10-18')`));
  await expectOk('목표를 바꾸면 이력이 남음', async () => {
    await db.query(`update promo_weeks set created_at = now() - interval '1 hour' where id=$1`, [w]);
    await as('lead', `update promo_targets set increment=50000 where week_id=$1`, [w]);
    await as('lead', `update promo_weeks set team_increment=95000 where id=$1`, [w]);
    const h = await as('lead', `select what from promo_history where week_id=$1 order by id`, [w]);
    if (h.rows.length !== 2) throw new Error(JSON.stringify(h.rows));
  });
  await expectBlocked('마감 결과를 직접 넣기', () => as('lead', `update promo_weeks set closed_at=now(), results='{}' where id=$1`, [w]));
  await expectOk('마감 버튼 → 결과 보관, 이후 목표 수정 막힘', async () => {
    await as('lead', `select promo_close($1, '{"team":{"achieved":true}}')`, [w]);
    try { await as('lead', `update promo_targets set increment=1 where week_id=$1`, [w]); throw new Error('고쳐짐'); } catch (e) { if (e.message === '고쳐짐') throw e; }
  });
  await expectBlocked('직원이 마감 풀기', () => as('kim', `select promo_reopen($1)`, [w]));
  await expectOk('팀장이 마감 풀면 다시 고칠 수 있음', async () => {
    await as('lead', `select promo_reopen($1)`, [w]);
    await as('lead', `update promo_targets set increment=1 where week_id=$1`, [w]);
  });
  return finish();
}
