// 4단계: 화면이 통합 DB 광고 표를 바로 읽음 — 재직 직원만, 예전과 같은 계산
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const tok = (await db.query(`select decrypted_secret t from vault.decrypted_secrets where name='ads_collector_token'`)).rows[0]?.t;
  const imp = (t, rows) => as(null, `select ads_import($1, $2, $3::jsonb)`, [tok, t, JSON.stringify(rows)]);
  await imp('ads_groups', [{ id: 1, name: '진원 인계', jinwon_handover: true }, { id: 2, name: '일반', jinwon_handover: false }]);
  await imp('ads_advertisers', [{ id: 10, name: '가게A', customer_id: '100', manager: '박규진' }, { id: 11, name: '가게B', customer_id: '200', manager: '서진원' }]);
  await imp('ads_group_members', [{ advertiser_id: 10, group_id: 1 }, { advertiser_id: 11, group_id: 2 }]);
  await imp('ads_transferred_daily', [
    { customer_id: '100', stat_date: '2026-10-01', paid_cost: 1000, advertiser_name: '가게A' },
    { customer_id: '100', stat_date: '2026-10-02', paid_cost: 500, advertiser_name: '가게A' },
    { customer_id: '200', stat_date: '2026-10-01', paid_cost: 3000, advertiser_name: '가게B' }]);
  await imp('ads_bizmoney_snapshots', [{ snapshot_date: '2026-10-08', customer_id: '100', status: 'normal', source: 'naver_api', gross_total_cost: 1500, bizmoney: 9 }]);
  await imp('ads_searchad_daily', [{ customer_id: '100', campaign_id: 'c1', stat_date: '2026-10-07', advertiser_id: 10, campaign_name: 'x', cost: 100, conversion_value: 300 }]);

  await expectOk('광고비 실적: 담당자별 네이버 + 진원 인계 그룹분', async () => {
    const r = (await as('kim', `select ads_local_perf_spend('2026-10-01','2026-10-31') v`)).rows[0].v;
    const a = r.naver.find((x) => x.customer_id === '100');
    if (Number(a.cost) !== 1500 || Number(a.handover_cost) !== 1500 || a.manager !== '박규진') throw new Error(JSON.stringify(r.naver));
    const b = r.naver.find((x) => x.customer_id === '200');
    if (b.handover_cost !== null) throw new Error('서진원 본인 담당은 인계 아님');
  });
  await expectOk('급여 월 소진: 서진원 인계분 따로', async () => {
    const r = (await as('lead', `select * from ads_local_month_spend('2026-10-01') order by employee_name`)).rows;
    const jin = r.find((x) => x.employee_name === '서진원');
    if (Number(jin.naver_spend) !== 3000 || Number(jin.handover_spend) !== 1500) throw new Error(JSON.stringify(r));
  });
  await expectOk('비즈머니 현황 · 수익률 · 프로모션 · 운영 상태', async () => {
    const b = (await as('kim', `select ads_local_export('bizmoney') v`)).rows[0].v;
    if (b.rows.length !== 1 || b.rows[0].client_group !== '진원 인계') throw new Error(JSON.stringify(b));
    const r = (await as('kim', `select ads_local_roas_watch() v`)).rows[0].v;
    if (r.rows.length !== 1) throw new Error(JSON.stringify(r));
    const p = (await as('kim', `select ads_local_promo_spend('2026-10-01','2026-10-02') v`)).rows[0].v;
    if (p.naver.length !== 3) throw new Error(JSON.stringify(p));
    await as('kim', `select ads_local_export('ops_status')`);
  });
  await expectBlocked('로그인 안 한 사람', () => as(null, `select ads_local_export('bizmoney')`));
  return finish();
}
