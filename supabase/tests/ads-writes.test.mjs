// 전환: 광고주 등록·수정·피이관·API를 통합 DB에 바로 — 대표·팀장만, 비밀값은 금고에
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  await db.query(`insert into ads_groups(id, name) values (1, '일반')`);
  await db.query(`insert into ads_manager_keys(manager, credential_group) values ('김직원', 'KIM')`);
  let id;
  await expectOk('팀장이 검색광고 광고주 등록', async () => {
    id = (await as('lead', `select ads_local_account_create('{"type":"SA","name":"가게","manager":"김직원","customer_id":"123","group_id":"1"}'::jsonb) v`)).rows[0].v;
    const a = (await db.query(`select credential_group from ads_advertisers where id=$1`, [id])).rows[0];
    if (a.credential_group !== 'KIM') throw new Error(JSON.stringify(a));
  });
  await expectBlocked('같은 Customer ID 다시 등록', () => as('lead', `select ads_local_account_create('{"type":"SA","name":"x","manager":"김직원","customer_id":"123","group_id":"1"}'::jsonb)`));
  await expectBlocked('직원이 광고주 등록', () => as('kim', `select ads_local_account_create('{"type":"SA","name":"y","manager":"김직원","customer_id":"999","group_id":"1"}'::jsonb)`));
  await expectOk('메타 광고주 등록 → 메타 계정·담당 배정까지', async () => {
    await as('lead', `select ads_local_account_create('{"type":"META","name":"메타가게","manager":"김직원","meta_id":"act_555","group_id":"1"}'::jsonb)`);
    const r = await db.query(`select m.external_account_id, p.manager from ads_meta_accounts m join ads_perf_assignments p on p.perf_account_id = m.perf_account_id`);
    if (r.rows[0]?.external_account_id !== 'act_555' || r.rows[0]?.manager !== '김직원') throw new Error(JSON.stringify(r.rows));
  });
  await expectOk('피이관으로 바꾸고 실적 올리기 (같은 날 두 줄이면 마지막)', async () => {
    await as('lead', `select ads_local_account_update($1, '{"adcost_source":"transferred","transferred_at":"2026-10-01"}'::jsonb)`, [id]);
    await as('lead', `select ads_local_transferred_import('[{"c":"123","d":"2026-10-01","v":100},{"c":"123","d":"2026-10-01","v":250}]'::jsonb, '2026-10-01', '2026-10-01')`);
    const r = await db.query(`select paid_cost from ads_transferred_daily where customer_id='123'`);
    if (Number(r.rows[0].paid_cost) !== 250) throw new Error(JSON.stringify(r.rows));
  });
  await expectOk('API 저장: 금고에, 표엔 끝 4자리 / 꺼내기 / 해제', async () => {
    await as('lead', `select ads_local_credential_save($1, 'naver_searchad', '123', 'KEY-ABCD', 'SECRET-1', '확인', '팀장')`, [id]);
    const row = (await db.query(`select key_hint, status from ads_api_credentials where advertiser_id=$1`, [id])).rows[0];
    if (row.key_hint !== 'ABCD' || row.status !== 'valid') throw new Error(JSON.stringify(row));
    const s = (await as('lead', `select ads_local_credential_secret($1, 'naver_searchad') v`, [id])).rows[0].v;
    if (s.apiKey !== 'KEY-ABCD' || s.secret !== 'SECRET-1') throw new Error('꺼내기 실패');
    const l = (await as('lead', `select ads_local_credentials() v`)).rows[0].v;
    if (!l.advertisers.find((a) => a.id === Number(id))?.naver) throw new Error('목록에 없음');
    await as('lead', `select ads_local_credential_blank($1, 'naver_searchad')`, [id]);
    await as('lead', `delete from ads_api_credentials where advertiser_id=$1`, [id]);
    if ((await db.query(`select 1 from ads_api_credentials where advertiser_id=$1`, [id])).rows.length) throw new Error('안 지워짐');
  });
  await expectBlocked('직원이 API 줄 지우기', async () => {
    const x = await as('kim', `delete from ads_api_credentials returning 1`);
    if (!x.rows.length) throw new Error('막힘');
  });
  await expectBlocked('직원이 비밀값 꺼내기', () => as('kim', `select ads_local_credential_secret(1, 'naver_searchad')`));
  await expectOk('사업자번호가 같은 거래처와 자동 연결 + 거래처 화면 요약', async () => {
    const c = (await as('lead', `insert into clients(company_name, business_number) values ('가게상회', '1234567800') returning id`)).rows[0].id;
    await as('lead', `select ads_set_business_number($1, '123-45-67800')`, [id]);
    const n = (await as('lead', `select ads_autolink_clients() n`)).rows[0].n;
    if (n !== 1) throw new Error(`연결 ${n}`);
    const list = (await as('kim', `select ads_client_accounts($1) v`, [c])).rows[0].v;
    if (list.length !== 1 || list[0].customer_id !== '123') throw new Error(JSON.stringify(list));
    await as('lead', `select ads_link_client($1, null)`, [id]);
    if ((await as('kim', `select ads_client_accounts($1) v`, [c])).rows[0].v.length) throw new Error('안 풀림');
  });
  await expectBlocked('직원이 연결 바꾸기', () => as('kim', `select ads_link_client($1, null)`, [id]));
  await expectBlocked('사업자번호 형식', () => as('lead', `select ads_set_business_number($1, '12345')`, [id]));
  return finish();
}
