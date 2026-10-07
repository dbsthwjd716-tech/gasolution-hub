// 급여: 대표·팀장만, 마감하면 잠김, 마감 해제는 대표만, 바이럴 판매가 집계
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  await db.exec(`update staff set can_view_cost=true where name='김직원'`);
  const id = async (n) => (await db.query(`select id from staff where name=$1`, [n])).rows[0].id;
  const kim = await id('김직원');
  const lee = await id('이직원');

  console.log('권한');
  await expectOk('팀장이 급여 설정 입력', () => as('lead', `insert into payroll_profiles(staff_id,track,base_pay,viral_rate) values ($1,'sales_ae',2000000,0.1)`, [kim]));
  await expectOk('직원(공급가 보기 권한이 있어도)에게는 급여 설정이 안 보임', async () => {
    const r = await as('kim', `select * from payroll_profiles`);
    if (r.rows.length) throw new Error('보임');
  });
  await expectBlocked('직원이 자기 급여 설정 입력', () => as('lee', `insert into payroll_profiles(staff_id,track) values ($1,'sales_ae')`, [lee]));
  await expectBlocked('직원이 바이럴 집계 함수로 실적 보기', async () => {
    const r = await as('kim', `select * from payroll_viral('2026-09-01')`);
    if (!r.rows.length) throw new Error('빈 결과');
  });
  await expectBlocked('직원이 구간표 고치기', () => as('kim', `insert into payroll_tiers(kind,min_spend,rate) values ('sales_ae',1,0.5)`));
  await expectOk('팀장이 구간표 입력', () => as('lead', `insert into payroll_tiers(kind,min_spend,rate) values ('sales_ae',40000000,0.03)`));

  console.log('달·마감');
  await expectOk('팀장이 9월 급여 시작', async () => {
    await as('lead', `insert into payroll_months(month,team_goal) values ('2026-09-01',100)`);
    await as('lead', `insert into payroll_entries(month,staff_id,inputs) values ('2026-09-01',$1,'{"naver_spend":50000000}')`, [kim]);
  });
  await expectBlocked('달 상태를 직접 마감으로 바꾸기', () => as('lead', `update payroll_months set status='closed' where month='2026-09-01'`));
  await expectOk('마감 함수로 마감 → 결과 보관', async () => {
    await as('lead', `select payroll_close('2026-09-01', $1::jsonb)`, [JSON.stringify([{ staff_id: kim, total: 2195000, snapshot: { lines: [] } }])]);
    const r = await db.query(`select total from payroll_entries where staff_id=$1`, [kim]);
    if (Number(r.rows[0].total) !== 2195000) throw new Error(JSON.stringify(r.rows));
  });
  await expectBlocked('마감된 달 입력값 고치기', () => as('lead', `update payroll_entries set inputs='{}' where staff_id=$1`, [kim]));
  await expectBlocked('마감된 달에 직원 추가', () => as('lead', `insert into payroll_entries(month,staff_id) values ('2026-09-01',$1)`, [lee]));
  await expectBlocked('마감된 달 팀 목표 고치기', () => as('lead', `update payroll_months set team_goal=1 where month='2026-09-01'`));
  await expectBlocked('팀장이 마감 해제 (대표만)', () => as('lead', `select payroll_reopen('2026-09-01')`));
  await expectOk('대표가 마감 해제 → 다시 고칠 수 있음', async () => {
    await as('ceo', `select payroll_reopen('2026-09-01')`);
    await as('lead', `update payroll_entries set inputs='{"naver_spend":1}' where staff_id=$1`, [kim]);
  });

  console.log('바이럴 집계');
  await expectOk('담당 판매가와 파생 판매가를 나눠 합산, 인센티브 제외 상품은 뺌', async () => {
    const pid = (await db.query(`select id from viral_partners where name='풀림'`)).rows[0].id;
    const c = (await as('lee', `insert into clients(company_name) values ('용접공구') returning id`)).rows[0].id;
    const o = (await as('lead', `insert into viral_orders(client_id,partner_id,paid_date,staff_id,derived_staff_id) values ($1,$2,'2026-09-10',$3,$4) returning id`, [c, pid, lee, kim])).rows[0].id;
    await as('lead', `insert into viral_order_items(order_id,description,sale_amount) values ($1,'메이크 2슬롯',300000),($1,'가구매 제품비',50000)`, [o]);
    await as('lead', `insert into viral_orders(client_id,partner_id,paid_date,staff_id) values ($1,$2,'2026-10-01',$3)`, [c, pid, lee]);
    const r = await as('lead', `select staff_id, own_sales, derived_sales from payroll_viral('2026-09-01')`);
    const L = r.rows.find((x) => x.staff_id === lee);
    const K = r.rows.find((x) => x.staff_id === kim);
    if (Number(L.own_sales) !== 300000 || Number(K.derived_sales) !== 300000 || Number(K.own_sales) !== 0) throw new Error(JSON.stringify(r.rows));
  });
  return finish();
}
