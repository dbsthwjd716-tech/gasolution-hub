// 직원 화면 미리보기: 대표·팀장만, 일반 직원만 대상, 미리보기 중 저장은 전부 막힘
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const id = async (n) => (await db.query(`select id from staff where name=$1`, [n])).rows[0].id;
  const kim = await id('김직원');
  const lee = await id('이직원');
  const ceo = await id('대표');
  const view = (target) => db.query(`select set_config('request.headers', $1, false)`, [target ? JSON.stringify({ 'x-hub-view-as': target }) : '']);

  await as('lead', `insert into promo_weeks(base_start,base_end,week_start,week_end) values ('2026-09-28','2026-10-04','2026-10-05','2026-10-11')`);
  await db.query(`update promo_weeks set team_increment = 1`); // 이력 1건 생성

  await expectOk('팀장이 김직원으로 보면 권한이 김직원 기준', async () => {
    await view(kim);
    const r = (await as('lead', `select my_staff_id() s, my_role() r, is_manager() m, can_view_cost() c`)).rows[0];
    if (r.s !== kim || r.r !== 'staff' || r.m !== false || r.c !== false) throw new Error(JSON.stringify(r));
  });
  await expectOk('미리보기 중에는 대표·팀장만 보는 이력이 안 보임', async () => {
    const r = await as('lead', `select * from promo_history`);
    if (r.rows.length) throw new Error('보임');
  });
  await expectBlocked('미리보기 중 저장', () => as('lead', `update promo_weeks set memo='x'`));
  await expectBlocked('미리보기 중 출근', () => as('lead', `select clock_in()`));
  await expectOk('직원이 다른 직원으로 보려 하면 무시', async () => {
    await view(lee);
    const r = (await as('kim', `select my_staff_id() s`)).rows[0];
    if (r.s !== kim) throw new Error('바뀜');
  });
  await expectOk('대표 화면으로 보기는 무시 (일반 직원만)', async () => {
    await view(ceo);
    const r = (await as('lead', `select my_role() r`)).rows[0];
    if (r.r !== 'lead') throw new Error(r.r);
  });
  await expectOk('잘못된 값은 무시', async () => {
    await view('abc');
    const r = (await as('lead', `select my_role() r`)).rows[0];
    if (r.r !== 'lead') throw new Error(r.r);
  });
  await expectOk('미리보기 끝내면 원래대로 저장 가능', async () => {
    await view(null);
    await as('lead', `update promo_weeks set memo='y'`);
  });
  await expectOk('인계건: 팀장 지정, 직원은 보기만', async () => {
    await as('lead', `insert into handover_accounts(customer_id, advertiser_name) values ('123','테스트')`);
    const r = await as('kim', `select * from handover_accounts`);
    if (r.rows.length !== 1) throw new Error('안 보임');
  });
  await expectBlocked('직원이 인계건 지정', () => as('kim', `insert into handover_accounts(customer_id) values ('456')`));
  await expectOk('모든 표에 미리보기 저장 차단이 걸려 있음', async () => {
    const r = await db.query(`select t.tablename from pg_tables t where t.schemaname='public' and not exists (select 1 from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=t.tablename and g.tgname='zz_preview_block')`);
    if (r.rows.length) throw new Error('빠진 표: ' + r.rows.map((x) => x.tablename).join(', '));
  });
  return finish();
}
