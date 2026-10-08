// 본인 급여 보기: 마감된 달의 본인 것만
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const id = async (n) => (await db.query(`select id from staff where name=$1`, [n])).rows[0].id;
  const kim = await id('김직원');
  const lee = await id('이직원');
  await as('lead', `insert into payroll_months(month) values ('2026-09-01'),('2026-10-01')`);
  await as('lead', `insert into payroll_entries(month, staff_id) values ('2026-09-01',$1),('2026-09-01',$2),('2026-10-01',$1)`, [kim, lee]);
  await as('lead', `select payroll_close('2026-09-01', $1)`, [JSON.stringify([{ staff_id: kim, total: 100, snapshot: { lines: [] } }, { staff_id: lee, total: 200, snapshot: { lines: [] } }])]);

  await expectOk('직원은 마감된 달의 본인 급여만 보임', async () => {
    const r = await as('kim', `select month::text, total from payroll_entries`);
    if (r.rows.length !== 1 || r.rows[0].month !== '2026-09-01' || Number(r.rows[0].total) !== 100) throw new Error(JSON.stringify(r.rows));
  });
  await expectBlocked('직원이 본인 급여 고치기', () => as('kim', `update payroll_entries set total = 1 where staff_id = $1`, [kim]));
  await expectOk('설정·구간표는 여전히 안 보임', async () => {
    const r = await as('kim', `select (select count(*) from payroll_profiles) p, (select count(*) from payroll_tiers) t`);
    if (Number(r.rows[0].p) || Number(r.rows[0].t)) throw new Error('보임');
  });
  return finish();
}
