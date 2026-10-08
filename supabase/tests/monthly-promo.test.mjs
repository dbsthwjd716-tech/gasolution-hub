// 월간 프로모션: 대표·팀장만 입력, 직원은 보기만, 팀장 줄은 직원에게 안 보임
import { setup } from './_db.mjs';

export async function run() {
  const { as, expectOk, expectBlocked, finish } = await setup();
  await expectOk('팀장이 달·팀원 입력', async () => {
    await as('lead', `insert into monthly_promo_months(month, team_target) values ('2026-10-01', 240000000)`);
    await as('lead', `insert into monthly_promo_members(month, name, target, is_leader, in_team) values ('2026-10-01','팀원A',50000000,false,true),('2026-10-01','팀장',140000000,true,false)`);
  });
  await expectBlocked('달 첫날이 아니면 안 됨', () => as('lead', `insert into monthly_promo_months(month) values ('2026-10-05')`));
  await expectOk('직원은 팀원 줄만 보임 (팀장 줄 숨김)', async () => {
    const x = await as('kim', `select name from monthly_promo_members`);
    if (x.rows.length !== 1 || x.rows[0].name !== '팀원A') throw new Error(JSON.stringify(x.rows));
  });
  await expectOk('팀장은 전부 보임', async () => {
    const x = await as('lead', `select name from monthly_promo_members`);
    if (x.rows.length !== 2) throw new Error('2줄 아님');
  });
  await expectBlocked('직원이 마감액 입력', async () => {
    const x = await as('kim', `update monthly_promo_members set actual = 1 where name='팀원A' returning name`);
    if (!x.rows.length) throw new Error('막힘');
  });
  await expectBlocked('직원이 달 추가', () => as('kim', `insert into monthly_promo_months(month) values ('2026-11-01')`));
  await expectBlocked('직원이 기준 변경', async () => {
    const x = await as('kim', `update monthly_promo_config set team_reward = 1 returning id`);
    if (!x.rows.length) throw new Error('막힘');
  });
  await expectOk('팀장이 기준 변경', () => as('lead', `update monthly_promo_config set partial = true`));
  return finish();
}
