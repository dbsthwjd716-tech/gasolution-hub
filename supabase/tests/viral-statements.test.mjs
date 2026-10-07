// 협력사 견적서: 권한 있는 사람만, 입금 → 세금계산서 순서, 연결된 바이럴 건도 같이 바뀜
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  await db.exec(`update staff set can_view_cost=true where name='김직원'`);
  const pid = (await db.query(`select id from viral_partners where name='풀림'`)).rows[0].id;
  const other = (await db.query(`select id from viral_partners where name='제이솔'`)).rows[0].id;
  const c = (await as('lee', `insert into clients(company_name) values ('용접공구') returning id`)).rows[0].id;
  // 이직원 담당 건 2개(풀림), 다른 협력사 건 1개
  const o1 = (await as('lee', `insert into viral_orders(client_id,partner_id,paid_date,sale_amount) values ($1,$2,'2026-10-02',100000) returning id`, [c, pid])).rows[0].id;
  const o2 = (await as('lee', `insert into viral_orders(client_id,partner_id,paid_date,sale_amount,invoice_status) values ($1,$2,'2026-10-03',50000,'not_needed') returning id`, [c, pid])).rows[0].id;
  const o3 = (await as('lee', `insert into viral_orders(client_id,partner_id,paid_date,sale_amount) values ($1,$2,'2026-10-03',70000) returning id`, [c, other])).rows[0].id;

  console.log('권한');
  let s;
  await expectOk('공급가 보기 직원(김직원)이 견적서 등록', async () => {
    s = (await as('kim', `insert into viral_partner_statements(partner_id,period_start,period_end,title,amount) values ($1,'2026-10-01','2026-10-07','10월 1주차',165000) returning id`, [pid])).rows[0].id;
  });
  await expectBlocked('권한 없는 직원은 견적서 등록', () =>
    as('lee', `insert into viral_partner_statements(partner_id,period_start,period_end,amount) values ($1,'2026-10-01','2026-10-07',1)`, [pid]));
  await expectOk('권한 없는 직원에게는 견적서가 안 보임', async () => {
    const r = await as('lee', `select * from viral_partner_statements`);
    if (r.rows.length) throw new Error('보임');
  });
  await expectBlocked('권한 없는 직원은 바이럴 건 연결', () => as('lee', `select viral_statement_link($1, array[$2]::uuid[])`, [s, o1]));

  console.log('연결·체크');
  await expectOk('다른 사람 담당 건도 연결 (다른 협력사 건은 빠짐)', async () => {
    const r = await as('kim', `select viral_statement_link($1, array[$2,$3,$4]::uuid[]) n`, [s, o1, o2, o3]);
    if (r.rows[0].n !== 2) throw new Error(String(r.rows[0].n));
  });
  await expectBlocked('입금 전에 세금계산서 발행 체크', () => as('kim', `update viral_partner_statements set invoice_done=true where id=$1`, [s]));
  await expectOk('입금 체크 → 연결된 건이 협력사 결제 완료, 입금일 자동', async () => {
    await as('kim', `update viral_partner_statements set paid=true where id=$1`, [s]);
    const paid = async (id) => (await db.query(`select partner_paid from viral_orders where id=$1`, [id])).rows[0].partner_paid;
    if (!(await paid(o1)) || !(await paid(o2)) || (await paid(o3))) throw new Error('결제 표시가 맞지 않음');
    const d = await db.query(`select paid_on from viral_partner_statements where id=$1`, [s]);
    if (!d.rows[0].paid_on) throw new Error('입금일 없음');
  });
  await expectOk('세금계산서 체크 → 연결된 건이 발행 (발행 불필요 건은 그대로)', async () => {
    await as('kim', `update viral_partner_statements set invoice_done=true where id=$1`, [s]);
    const a = await db.query(`select invoice_status, invoice_issued_at from viral_orders where id=$1`, [o1]);
    const b = await db.query(`select invoice_status from viral_orders where id=$1`, [o2]);
    if (a.rows[0].invoice_status !== 'issued' || !a.rows[0].invoice_issued_at || b.rows[0].invoice_status !== 'not_needed') throw new Error(JSON.stringify([a.rows, b.rows]));
  });
  await expectBlocked('세금계산서 체크된 채로 입금 해제', () => as('kim', `update viral_partner_statements set paid=false where id=$1`, [s]));
  await expectOk('연결 해제', async () => {
    await as('kim', `select viral_statement_link($1, array[$2]::uuid[])`, [s, o1]);
    const r = await db.query(`select partner_statement_id from viral_orders where id=$1`, [o2]);
    if (r.rows[0].partner_statement_id) throw new Error('해제 안 됨');
  });
  await expectOk('파일 기록', () => as('kim', `insert into viral_partner_statement_files(statement_id,file_name,storage_path) values ($1,'견적서.pdf','viral/statements/2026-10/1.pdf')`, [s]));
  await expectBlocked('직원은 견적서 삭제 불가 (대표·팀장만)', async () => {
    const r = await as('kim', `delete from viral_partner_statements where id=$1 returning id`, [s]);
    if (!r.rows.length) throw new Error('지워지지 않음');
  });
  await expectOk('팀장은 삭제 → 연결된 건은 남고 연결만 풀림', async () => {
    await as('lead', `delete from viral_partner_statements where id=$1`, [s]);
    const r = await db.query(`select partner_statement_id, partner_paid from viral_orders where id=$1`, [o1]);
    if (r.rows[0].partner_statement_id || !r.rows[0].partner_paid) throw new Error(JSON.stringify(r.rows[0]));
  });
  return finish();
}
