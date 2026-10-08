// 바이럴 새 건: 건 + 여러 상품 줄을 한 번에, 줄이 실패하면 건도 남지 않음
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const pid = (await db.query(`select id from viral_partners where name='풀림'`)).rows[0].id;
  const c = (await as('lee', `insert into clients(company_name) values ('테스트상회') returning id`)).rows[0].id;
  const order = JSON.stringify({ client_id: c, partner_id: pid, paid_date: '2026-10-08' });
  const two = JSON.stringify([{ sort_order: 0, description: '슬롯 A', sale_amount: 100000 }, { sort_order: 1, description: '슬롯 B', sale_amount: 50000 }]);
  await expectOk('직원이 상품 두 줄짜리 새 건 등록 (예전 오류 상황)', async () => {
    const id = (await as('lee', `select viral_create_order($1::jsonb, $2::jsonb) id`, [order, two])).rows[0].id;
    const r = await db.query(`select count(*) n, sum(sale_amount) s from viral_order_items where order_id=$1`, [id]);
    if (Number(r.rows[0].n) !== 2 || Number(r.rows[0].s) !== 150000) throw new Error(JSON.stringify(r.rows[0]));
    const o = await db.query(`select staff_id from viral_orders where id=$1`, [id]);
    const lee = (await db.query(`select id from staff where name='이직원'`)).rows[0].id;
    if (o.rows[0].staff_id !== lee) throw new Error('담당 자동 지정 안 됨');
  });
  await expectBlocked('공급가 권한 없는 직원이 공급가 입력 → 실패', () =>
    as('lee', `select viral_create_order($1::jsonb, $2::jsonb)`, [order, JSON.stringify([{ description: 'x', sale_amount: 1, cost_amount: 999 }])]));
  await expectOk('실패한 건은 남지 않음', async () => {
    const r = await db.query(`select count(*) n from viral_orders where client_id=$1`, [c]);
    if (Number(r.rows[0].n) !== 1) throw new Error(`건 ${r.rows[0].n}개`);
  });
  return finish();
}
