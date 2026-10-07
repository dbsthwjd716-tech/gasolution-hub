// 바이럴 상품 구조 · 단가표 · 환불/미소진 잔액 시험
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const pid = (await db.query(`select id from viral_partners where name='풀림'`)).rows[0].id;
  const c1 = (await as('kim', `insert into clients(company_name) values ('용접공구') returning id`)).rows[0].id;
  const c2 = (await as('lee', `insert into clients(company_name) values ('다른업체') returning id`)).rows[0].id;
  const o = (await as('kim', `insert into viral_orders(client_id,partner_id,paid_date) values ($1,$2,'2026-10-02') returning id`, [c1, pid])).rows[0].id;

  console.log('상품 줄');
  await expectOk('슬롯 30일 2개 줄 등록 (종류·매체·일수·수량)', () =>
    as('kim', `insert into viral_order_items(order_id,product_type,platform,product_name,days,quantity,cost_amount,sale_amount)
       values ($1,'슬롯','네이버','메이크',30,2,220000,396000)`, [o]));
  await expectBlocked('없는 상품 종류', () => as('kim', `insert into viral_order_items(order_id,product_type) values ($1,'광고')`, [o]));
  await expectOk('가구매 제품비 종류는 자동으로 인센티브 제외', async () => {
    const r = await as('kim', `insert into viral_order_items(order_id,product_type,sale_amount) values ($1,'가구매 제품비',100000) returning incentive_excluded`, [o]);
    if (!r.rows[0].incentive_excluded) throw new Error('제외 안 됨');
  });

  await expectOk('시트처럼 내용만 있으면 종류·일수·수량·매체를 자동으로 채움', async () => {
    const r = await as('kim', `insert into viral_order_items(order_id,description,sale_amount) values ($1,'26.10.04~26.11.02(30일) 메이크 2슬롯씩',396000) returning product_type,days,quantity,platform`, [o]);
    const x = r.rows[0];
    if (x.product_type !== '슬롯' || x.days !== 30 || Number(x.quantity) !== 2 || x.platform !== '네이버') throw new Error(JSON.stringify(x));
  });

  console.log('단가표');
  await expectOk('팀장이 단가 등록', () =>
    as('lead', `insert into viral_price_list(partner_id,product_type,platform,product_name,days,unit_label,cost_price,sale_price)
       values ($1,'슬롯','네이버','메이크',30,'슬롯',110000,198000)`, [pid]));
  await expectBlocked('같은 조건 단가 중복 등록', () =>
    as('lead', `insert into viral_price_list(partner_id,product_type,platform,product_name,days,cost_price,sale_price) values ($1,'슬롯','네이버','메이크',30,1,1)`, [pid]));
  await expectBlocked('직원이 단가 수정', () => as('kim', `update viral_price_list set sale_price=1`));
  await expectOk('직원도 단가는 볼 수 있음', async () => {
    const r = await as('kim', `select sale_price from viral_price_list`);
    if (Number(r.rows[0].sale_price) !== 198000) throw new Error(JSON.stringify(r.rows));
  });

  console.log('환불 · 미소진');
  await expectOk('환불 발생 10만 → 환급 3만 → 다음 건 차감 2만 = 환불 잔액 5만', async () => {
    await as('kim', `insert into viral_credits(client_id,order_id,kind,entry,amount,partner_refund,memo) values ($1,$2,'refund','refund_issued',100000,55000,'순위 미달')`, [c1, o]);
    await as('kim', `insert into viral_credits(client_id,order_id,kind,entry,amount) values ($1,$2,'refund','refund_paid',30000)`, [c1, o]);
    await as('kim', `insert into viral_credits(client_id,kind,entry,amount) values ($1,'refund','refund_applied',20000)`, [c1]);
    const r = await as('lee', `select refund_balance, prepaid_balance from viral_credit_balances where client_id=$1`, [c1]);
    if (Number(r.rows[0].refund_balance) !== 50000 || Number(r.rows[0].prepaid_balance) !== 0) throw new Error(JSON.stringify(r.rows[0]));
  });
  await expectOk('미소진 발생 20만 → 서비스 작업 사용 8만 = 미소진 잔액 12만 (환불과 따로 계산)', async () => {
    await as('kim', `insert into viral_credits(client_id,order_id,kind,entry,amount) values ($1,$2,'prepaid','prepaid_received',200000)`, [c1, o]);
    await as('kim', `insert into viral_credits(client_id,kind,entry,amount,memo) values ($1,'prepaid','prepaid_used',80000,'블로그 서비스')`, [c1]);
    const r = await db.query(`select refund_balance, prepaid_balance from viral_credit_balances where client_id=$1`, [c1]);
    if (Number(r.rows[0].refund_balance) !== 50000 || Number(r.rows[0].prepaid_balance) !== 120000) throw new Error(JSON.stringify(r.rows[0]));
  });
  await expectOk('기록에 그 건의 담당자가 자동으로 붙음', async () => {
    const r = await db.query(`select s.name from viral_credits v join staff s on s.id=v.staff_id where v.order_id=$1 limit 1`, [o]);
    if (r.rows[0].name !== '김직원') throw new Error(r.rows[0].name);
  });
  await expectBlocked('종류와 내용이 안 맞음 (미소진에 환불 발생)', () =>
    as('kim', `insert into viral_credits(client_id,kind,entry,amount) values ($1,'prepaid','refund_issued',1)`, [c1]));
  await expectBlocked('0원·마이너스 금액', () =>
    as('kim', `insert into viral_credits(client_id,kind,entry,amount) values ($1,'refund','refund_issued',-1)`, [c1]));
  await expectBlocked('다른 거래처의 바이럴 건에 기록', () =>
    as('kim', `insert into viral_credits(client_id,order_id,kind,entry,amount) values ($1,$2,'refund','refund_issued',1)`, [c2, o]));
  await expectBlocked('남의 담당 건에 환불 기록', () =>
    as('lee', `insert into viral_credits(client_id,order_id,kind,entry,amount) values ($1,$2,'refund','refund_issued',1)`, [c1, o]));
  await expectBlocked('남이 쓴 기록 수정', () => as('lee', `update viral_credits set amount=1 where client_id=$1`, [c1]));
  await expectBlocked('로그인 안 한 사람이 잔액 보기', () => as(null, `select * from viral_credit_balances`));

  return finish();
}
