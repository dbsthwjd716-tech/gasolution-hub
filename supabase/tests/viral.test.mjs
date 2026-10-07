// 2단계 바이럴 시험: 거래처 정보 자동 연결, 마진 계산, 상태 관리, 권한
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();

  const pid = (await db.query(`select id from viral_partners where name='제이솔'`)).rows[0].id;
  const c1 = (await as('kim', `insert into clients(company_name,business_number,representative_name,address,billing_emails)
      values ('용접공구','122-01-55229','홍길동','서울 금천구','{tax@weld.kr}') returning id`)).rows[0].id;
  const c2 = (await as('lee', `insert into clients(company_name) values ('다른업체') returning id`)).rows[0].id;
  const b2 = (await as('lee', `insert into brands(client_id,name) values ($1,'다른브랜드') returning id`, [c2])).rows[0].id;

  console.log('바이럴 등록');
  const o = await expectOk('김직원이 거래처를 골라 바이럴 건 등록', () =>
    as('kim', `insert into viral_orders(client_id,partner_id,paid_date,description,cost_amount,sale_amount)
       values ($1,$2,'2026-10-07','블로그리뷰 30건',59400,132000) returning id, staff_id, margin_amount, cost_net_amount`, [c1, pid]));
  const oid = o.rows[0].id;
  await expectOk('마진은 VAT 별도 기준: 판매가 132,000 - 공급가 59,400÷1.1(54,000) = 78,000', async () => {
    if (Number(o.rows[0].cost_net_amount) !== 54000) throw new Error('공급가(VAT 별도) ' + o.rows[0].cost_net_amount);
    if (Number(o.rows[0].margin_amount) !== 78000) throw new Error('마진 ' + o.rows[0].margin_amount);
  });
  await expectOk('등록한 직원이 담당자로 자동 지정', async () => {
    const r = await db.query(`select name from staff where id=$1`, [o.rows[0].staff_id]);
    if (r.rows[0].name !== '김직원') throw new Error(r.rows[0].name);
  });
  await expectOk('목록에서 거래처의 대표자·사업자번호·주소·메일이 자동으로 붙음', async () => {
    const r = await as('lee', `select representative_name, business_number, address, billing_emails, partner_name, staff_name
                                 from viral_orders_view where id=$1`, [oid]);
    const x = r.rows[0];
    if (x.representative_name !== '홍길동' || x.business_number !== '1220155229' || x.address !== '서울 금천구'
        || x.billing_emails[0] !== 'tax@weld.kr' || x.partner_name !== '제이솔' || x.staff_name !== '김직원')
      throw new Error(JSON.stringify(x));
  });
  await expectOk('거래처에 바이럴 표시가 자동으로 붙음', async () => {
    const r = await db.query(`select kinds from clients where id=$1`, [c1]);
    if (!r.rows[0].kinds.includes('viral')) throw new Error(r.rows[0].kinds);
  });
  await expectOk('거래처 주소를 고치면 바이럴 목록에도 바로 반영', async () => {
    await as('kim', `update clients set address='서울 구로구' where id=$1`, [c1]);
    const r = await as('kim', `select address from viral_orders_view where id=$1`, [oid]);
    if (r.rows[0].address !== '서울 구로구') throw new Error(r.rows[0].address);
  });
  await expectBlocked('다른 거래처의 브랜드를 붙이기', () =>
    as('kim', `insert into viral_orders(client_id,brand_id,partner_id,paid_date,sale_amount) values ($1,$2,$3,'2026-10-07',1000)`, [c1, b2, pid]));
  await expectBlocked('거래처 없이 등록', () =>
    as('kim', `insert into viral_orders(partner_id,paid_date,sale_amount) values ($1,'2026-10-07',1000)`, [pid]));
  await expectOk('환불·취소는 마이너스 금액으로 등록 가능 (마진도 마이너스)', async () => {
    const r = await as('kim', `insert into viral_orders(client_id,partner_id,paid_date,sale_amount,cost_amount)
        values ($1,$2,'2026-10-07',-132000,-59400) returning margin_amount`, [c1, pid]);
    if (Number(r.rows[0].margin_amount) !== -78000) throw new Error(String(r.rows[0].margin_amount));
  });
  await expectBlocked('판매가 칸 없이 등록', () =>
    as('kim', `insert into viral_orders(client_id,partner_id,paid_date) values ($1,$2,'2026-10-07')`, [c1, pid]));
  await expectOk('입금 전 건은 입금일 없이 등록하고, 목록의 기준일은 진행 시작일', async () => {
    const r = await as('kim', `insert into viral_orders(client_id,partner_id,start_date,sale_amount) values ($1,$2,'2026-10-20',100000) returning id`, [c1, pid]);
    const v = await as('kim', `select paid_date, base_date::text from viral_orders_view where id=$1`, [r.rows[0].id]);
    if (v.rows[0].paid_date !== null || v.rows[0].base_date !== '2026-10-20') throw new Error(JSON.stringify(v.rows[0]));
  });

  console.log('상태 관리');
  await expectOk('세금계산서 발행 처리하면 발행일이 자동으로 오늘', async () => {
    const r = await as('kim', `update viral_orders set invoice_status='issued', payment_received=true where id=$1 returning invoice_issued_at`, [oid]);
    if (!r.rows[0]?.invoice_issued_at) throw new Error('발행일 없음');
  });
  await expectOk('협력사 결제 처리', async () => {
    const r = await as('kim', `update viral_orders set partner_paid=true, partner_paid_amount=59400 where id=$1`, [oid]);
    if (r.affectedRows !== 1) throw new Error('0건');
  });

  console.log('권한');
  await expectBlocked('이직원이 김직원 담당 건 수정', () =>
    as('lee', `update viral_orders set sale_amount=1 where id=$1`, [oid]));
  await expectBlocked('김직원이 본인 건을 이직원 담당으로 넘기기', () =>
    as('kim', `update viral_orders set staff_id=(select id from staff where name='이직원') where id=$1`, [oid]));
  await expectOk('팀장은 담당자 변경 가능', async () => {
    const r = await as('lead', `update viral_orders set staff_id=(select id from staff where name='이직원') where id=$1`, [oid]);
    if (r.affectedRows !== 1) throw new Error('0건');
  });
  await expectBlocked('팀장도 바이럴 건 삭제는 못 함', () => as('lead', `delete from viral_orders where id=$1`, [oid]));
  await expectBlocked('직원이 협력사 추가', () => as('kim', `insert into viral_partners(name) values ('새협력사')`));
  await expectBlocked('로그인 안 한 사람이 바이럴 목록 조회', () => as(null, `select * from viral_orders_view`));
  await expectOk('바이럴 변경도 변경 기록에 남음', async () => {
    const r = await as('lead', `select count(*)::int n from change_log where table_name='viral_orders'`);
    if (r.rows[0].n < 4) throw new Error(String(r.rows[0].n));
  });
  await expectBlocked('같은 시트 줄을 두 번 옮기기', async () => {
    await db.query(`insert into viral_orders(client_id,partner_id,paid_date,sale_amount,source_sheet,source_row) values ($1,$2,'2025-11-05',1,'제이솔',2)`, [c1, pid]);
    return db.query(`insert into viral_orders(client_id,partner_id,paid_date,sale_amount,source_sheet,source_row) values ($1,$2,'2025-11-05',1,'제이솔',2)`, [c1, pid]);
  });

  console.log('시트 옮기기 담당자');
  await expectOk('시트에서 옮긴 건은 담당자를 못 찾으면 비워 둠 (옮긴 사람으로 채우지 않음)', async () => {
    const r = await as('lead', `insert into viral_orders(client_id,partner_id,paid_date,sale_amount,source_sheet,source_row) values ($1,$2,'2026-01-01',1,'풀림',999) returning staff_id`, [c1, pid]);
    if (r.rows[0].staff_id !== null) throw new Error('담당자가 채워짐');
  });
  await expectOk('퇴사 직원은 이메일 없이 등록 가능', () => as('ceo', `insert into staff(name,role,is_active) values ('퇴사자','staff',false)`));
  await expectBlocked('재직 직원은 이메일이 꼭 있어야 함', () => as('ceo', `insert into staff(name,role,is_active) values ('재직자','staff',true)`));

  return finish();
}
