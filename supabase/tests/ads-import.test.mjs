// 광고 수집 이전: 수집기 열쇠가 있어야 가져오기, 같은 키는 새 값으로, id 유지
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const tok = (await db.query(`select decrypted_secret t from vault.decrypted_secrets where name='ads_collector_token'`)).rows[0]?.t;
  const adv = JSON.stringify([{ id: 7, name: '가게', customer_id: '111', manager: '김직원', adcost_source: 'auto', created_at: '2026-10-01T00:00:00Z' }]);
  await expectOk('열쇠는 데이터베이스가 만들어 둠', async () => { if (!tok || tok.length < 64) throw new Error('없음'); });
  await expectBlocked('틀린 열쇠로 가져오기', () => as(null, `select ads_import($1, 'ads_advertisers', $2::jsonb)`, ['x'.repeat(64), adv]));
  await expectBlocked('직원이 표에 직접 쓰기', () => as('kim', `insert into ads_advertisers(name) values ('x')`));
  await expectOk('가져오기 + 다시 가져오면 새 값으로 (id 유지)', async () => {
    await as(null, `select ads_import($1, 'ads_advertisers', $2::jsonb)`, [tok, adv]);
    await as(null, `select ads_import($1, 'ads_advertisers', $2::jsonb)`, [tok, adv.replace('가게', '가게2')]);
    const r = await db.query(`select id, name from ads_advertisers`);
    if (r.rows.length !== 1 || Number(r.rows[0].id) !== 7 || r.rows[0].name !== '가게2') throw new Error(JSON.stringify(r.rows));
  });
  await expectOk('가져오기 끝나면 새 번호는 가장 큰 id 다음', async () => {
    await as(null, `select ads_import_finish($1)`, [tok]);
    const r = await db.query(`insert into ads_advertisers(name) values ('새') returning id`);
    if (Number(r.rows[0].id) !== 8) throw new Error(String(r.rows[0].id));
  });
  await expectOk('직원도 읽기는 가능', async () => {
    const r = await as('kim', `select count(*) n from ads_advertisers`);
    if (Number(r.rows[0].n) !== 2) throw new Error('안 보임');
  });
  await expectBlocked('직원이 수집 작업 실행', () => as('kim', `select ads_run_job('bizmoney-snapshot')`));
  await expectOk('비밀값은 금고에, 표에는 금고 id만 / 열쇠 있어야 꺼냄', async () => {
    await as(null, `select ads_store_env($1, '{"NAVER_SOJUNG_API_KEY":"k1","EVIL":"x"}'::jsonb)`, [tok]);
    await as(null, `select ads_store_credential($1, '{"advertiser_id":7,"platform":"naver_searchad","account_id":"111","api_key":"AK","secret":"SK","status":"valid"}'::jsonb)`, [tok]);
    const row = (await db.query(`select * from ads_api_credentials`)).rows[0];
    if (JSON.stringify(row).includes('"SK"') || JSON.stringify(row).includes('"AK"')) throw new Error('표에 비밀값');
    const s = (await as(null, `select ads_collector_secrets($1) s`, [tok])).rows[0].s;
    if (s.env.NAVER_SOJUNG_API_KEY !== 'k1' || s.env.EVIL || s.credentials[0].secret !== 'SK') throw new Error(JSON.stringify(s));
  });
  await expectBlocked('열쇠 없이 비밀값 꺼내기', () => as('lead', `select ads_collector_secrets('x')`));
  await expectOk('직원은 API 상태 표도 안 보임', async () => {
    const r = await as('kim', `select count(*) n from ads_api_credentials`);
    if (Number(r.rows[0].n) !== 0) throw new Error('보임');
  });
  return finish();
}
