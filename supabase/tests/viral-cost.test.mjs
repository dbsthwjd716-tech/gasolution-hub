// 바이럴 공급가·마진 보기 권한: 대표·팀장 + '공급가 보기'를 켠 직원(김직원)만, 이직원은 못 봄
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  await db.exec(`update staff set can_view_cost=true where name='김직원'`);
  const pid = (await db.query(`select id from viral_partners where name='풀림'`)).rows[0].id;
  const c = (await as('lee', `insert into clients(company_name) values ('용접공구') returning id`)).rows[0].id;
  await as('lead', `insert into viral_price_list(partner_id,product_type,platform,product_name,days,cost_price,sale_price)
                    values ($1,'슬롯','네이버','메이크',30,110000,198000)`, [pid]);

  console.log('권한 없는 직원 (이직원)');
  const o = (await as('lee', `insert into viral_orders(client_id,partner_id,paid_date) values ($1,$2,'2026-10-02') returning id`, [c, pid])).rows[0].id;
  await expectOk('공급가 없이 상품 줄 입력 → 단가표에 맞으면 공급가 자동 (220,000)', async () => {
    await as('lee', `insert into viral_order_items(order_id,product_type,platform,product_name,days,quantity,sale_amount) values ($1,'슬롯','네이버','메이크',30,2,396000)`, [o]);
    const r = await db.query(`select cost_amount, margin_amount from viral_orders where id=$1`, [o]);
    if (Number(r.rows[0].cost_amount) !== 220000 || Number(r.rows[0].margin_amount) !== 196000) throw new Error(JSON.stringify(r.rows[0]));
  });
  await expectOk('수량을 바꾸면 공급가도 단가표로 다시 계산', async () => {
    await as('lee', `update viral_order_items set quantity=3, sale_amount=594000 where order_id=$1`, [o]);
    const r = await db.query(`select cost_amount from viral_order_items where order_id=$1`, [o]);
    if (Number(r.rows[0].cost_amount) !== 330000) throw new Error(String(r.rows[0].cost_amount));
  });
  await expectBlocked('바이럴 건의 공급가 읽기', () => as('lee', `select cost_amount from viral_orders`));
  await expectBlocked('바이럴 건의 마진 읽기', () => as('lee', `select margin_amount from viral_orders`));
  await expectBlocked('상품 줄의 공급가 읽기', () => as('lee', `select cost_amount from viral_order_items`));
  await expectBlocked('단가표의 공급가 읽기', () => as('lee', `select cost_price from viral_price_list`));
  await expectBlocked('예전 목록 보기(공급가 포함) 읽기', () => as('lee', `select * from viral_orders_view`));
  await expectOk('공급가 함수는 빈 결과', async () => {
    const r = await as('lee', `select * from viral_order_costs(array[$1]::uuid[])`, [o]);
    const p = await as('lee', `select * from viral_price_costs()`);
    if (r.rows.length || p.rows.length) throw new Error('보임');
  });
  await expectOk('판매가·입금·협력사 결제 여부는 볼 수 있음', async () => {
    const r = await as('lee', `select sale_amount, payment_received, partner_paid, partner_name from viral_orders_list where id=$1`, [o]);
    if (Number(r.rows[0].sale_amount) !== 594000) throw new Error(JSON.stringify(r.rows[0]));
  });
  await expectBlocked('공급가를 직접 적기', () =>
    as('lee', `insert into viral_order_items(order_id,description,cost_amount,sale_amount) values ($1,'x',1000,2000)`, [o]));
  await expectBlocked('공급가 고치기', () => as('lee', `update viral_order_items set cost_amount=1 where order_id=$1`, [o]));
  await expectBlocked('협력사 결제 금액 적기', () => as('lee', `update viral_orders set partner_paid_amount=1 where id=$1`, [o]));
  await expectOk('협력사 결제 여부 체크는 가능', () => as('lee', `update viral_orders set partner_paid=true where id=$1`, [o]));
  await expectBlocked('스스로 공급가 보기 권한 켜기', () => as('lee', `update staff set can_view_cost=true where name='이직원'`));

  console.log('권한 있는 사람');
  await expectOk('공급가 보기 직원(김직원)은 함수로 공급가·마진을 봄', async () => {
    const r = await as('kim', `select cost_amount, margin_amount from viral_order_costs(array[$1]::uuid[])`, [o]);
    if (Number(r.rows[0]?.cost_amount) !== 330000) throw new Error(JSON.stringify(r.rows));
    const i = await as('kim', `select cost_amount from viral_item_costs($1)`, [o]);
    if (i.rows.length !== 1) throw new Error('줄 공급가 없음');
  });
  await expectOk('팀장은 단가표 공급가를 봄', async () => {
    const r = await as('lead', `select cost_price from viral_price_costs()`);
    if (Number(r.rows[0].cost_price) !== 110000) throw new Error(JSON.stringify(r.rows));
  });
  await expectOk('공급가 보기 직원은 자기 건에 공급가를 직접 적을 수 있음', async () => {
    const k = (await as('kim', `insert into viral_orders(client_id,partner_id,paid_date) values ($1,$2,'2026-10-02') returning id`, [c, pid])).rows[0].id;
    await as('kim', `insert into viral_order_items(order_id,description,cost_amount,sale_amount) values ($1,'직접',50000,80000)`, [k]);
  });
  await expectBlocked('팀장도 공급가 보기 권한은 못 바꿈 (대표만)', () => as('lead', `update staff set can_view_cost=true where name='이직원'`));
  await expectOk('대표가 공급가 보기 권한을 켬', () => as('ceo', `update staff set can_view_cost=true where name='이직원'`));

  return finish();
}
