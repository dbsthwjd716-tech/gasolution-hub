// 예전 인입 CRM 문의 옮기기: 대표·팀장만, 다시 눌러도 중복 없음, 담당·기록 연결
import { setup } from './_db.mjs';

const payload = {
  leads: [
    { id: 'a1', inquiry_at: '2026-09-01T01:00:00Z', company_name: '용접공구', contact_name: '이병석', phone: '010-1234-5678', monthly_budget: 3000000,
      source: '네이버', media: ['네이버'], inquiry_content: '파워링크 문의', status: '계약완료', memo: '좋은 고객', last_contact_at: '2026-09-03T02:00:00Z',
      expected_contract_amount: 3300000, contract_amount: null, failure_reason: null, owner: '김직원', created_by: '팀장' },
    { id: 'a2', inquiry_at: '2026-09-02T01:00:00Z', company_name: '수라간떡방', phone: null, media: [], status: '종료',
      owner: '김직원>퇴사자', failure_reason: '예산 부족' },
    { id: 'a3', inquiry_at: '2026-09-03T01:00:00Z', company_name: '', status: '스팸', owner: null },
  ],
  logs: [
    { lead_id: 'a1', at: '2026-09-02T01:00:00Z', type: '전화', content: '첫 통화', by: '김직원' },
    { lead_id: 'a1', at: '2026-09-03T02:00:00Z', type: '이상한값', content: '견적 전달', by: '없는사람' },
  ],
  history: [
    { lead_id: 'a1', at: '2026-09-01T01:00:00Z', old: null, new: '연락 전', by: '팀장' },
    { lead_id: 'a1', at: '2026-09-05T01:00:00Z', old: '상담중', new: '계약완료', by: '김직원' },
  ],
};

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();

  await expectBlocked('직원이 옮기기 실행', () => as('kim', `select import_legacy_leads($1::jsonb)`, [JSON.stringify(payload)]));
  await expectOk('팀장이 옮기기 → 3건, 기록 4개, 퇴사자 직원 자동 생성', async () => {
    const r = (await as('lead', `select import_legacy_leads($1::jsonb) r`, [JSON.stringify(payload)])).rows[0].r;
    if (r.inserted !== 3 || r.activities !== 4 || r.created_staff[0] !== '퇴사자') throw new Error(JSON.stringify(r));
  });
  await expectOk('담당·등록자·메모·마지막 연락 시각', async () => {
    const r = (await db.query(`select l.*, s.name staff, c.name creator from leads l left join staff s on s.id=l.staff_id left join staff c on c.id=l.created_by where source_ref='crm:a1'`)).rows[0];
    if (r.staff !== '김직원' || r.creator !== '팀장' || !r.memo.includes('예상 계약금액 3,300,000원') || r.phone_digits !== '01012345678'
        || new Date(r.last_contact_at).toISOString() !== '2026-09-03T02:00:00.000Z' || Number(r.monthly_budget) !== 3000000) throw new Error(JSON.stringify(r));
  });
  await expectOk('바뀐 담당 기록은 마지막 사람 + 원문 보관, 실패 사유는 메모로', async () => {
    const r = (await db.query(`select l.legacy_owner, l.memo, s.name staff, s.is_active from leads l join staff s on s.id=l.staff_id where source_ref='crm:a2'`)).rows[0];
    if (r.staff !== '퇴사자' || r.is_active || r.legacy_owner !== '김직원>퇴사자' || !r.memo.includes('실패 사유: 예산 부족')) throw new Error(JSON.stringify(r));
  });
  await expectOk('업체명 없는 문의도 옮김, 상태 그대로', async () => {
    const r = (await db.query(`select company_name, status, staff_id from leads where source_ref='crm:a3'`)).rows[0];
    if (r.company_name !== '(업체명 없음)' || r.status !== '스팸' || r.staff_id) throw new Error(JSON.stringify(r));
  });
  await expectOk('기록 종류: 예전 값이 이상하면 기타, 상태 이력은 등록·상태 변경', async () => {
    const r = await db.query(`select activity_type, content from lead_activities a join leads l on l.id=a.lead_id where l.source_ref='crm:a1' order by occurred_at`);
    const types = r.rows.map((x) => x.activity_type).join(',');
    if (types !== '등록,전화,기타,상태 변경') throw new Error(types);
  });
  await expectOk('다시 실행해도 중복 없음', async () => {
    const r = (await as('lead', `select import_legacy_leads($1::jsonb) r`, [JSON.stringify(payload)])).rows[0].r;
    const n = (await db.query(`select count(*) from leads`)).rows[0].count;
    if (r.inserted !== 0 || r.skipped !== 3 || Number(n) !== 3) throw new Error(JSON.stringify(r));
  });
  return finish();
}
