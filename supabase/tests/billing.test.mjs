// 3단계 정산·계약 시험: 승인 흐름(직원 → 팀장 → 대표), 금액 잠금, 계약 권한
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  await db.exec(`insert into suppliers(code,name) values ('ga','(주)지에이솔루션'),('copycoach','카피코치랩')`);

  const c1 = (await as('kim', `insert into clients(company_name,business_number) values ('티키타카','122-01-55229') returning id`)).rows[0].id;

  console.log('계약');
  const k = await expectOk('김직원이 계약 등록 (담당자 자동 지정)', () =>
    as('kim', `insert into contracts(client_id,media,markup_type,markup_rate,min_fee)
       values ($1,'{meta}','rate',12.1,330000) returning id, staff_id, status`, [c1]));
  const kid = k.rows[0].id;
  await expectBlocked('직원이 스스로 계약 완료 처리', () =>
    as('kim', `update contracts set status='active', completion_type='no_document' where id=$1`, [kid]));
  await expectBlocked('계약서 없이 완료로 표시하지 않고 완료', () =>
    as('lead', `update contracts set status='active' where id=$1`, [kid]));
  await expectOk('팀장이 계약 완료 (계약서 없이)', () =>
    as('lead', `update contracts set status='active', completion_type='no_document' where id=$1`, [kid]));
  await expectBlocked('완료된 계약의 요율을 직원이 수정', () =>
    as('kim', `update contracts set markup_rate=20 where id=$1`, [kid]));
  await expectBlocked('서명본 없이 서명 완료로 표시', () =>
    as('lead', `insert into contracts(client_id,status,completion_type) values ($1,'active','signed_document')`, [c1]));
  await expectBlocked('다른 직원이 남의 계약 수정', () =>
    as('lee', `update contracts set special_terms='x' where id=$1`, [kid]));

  console.log('정산 승인 흐름');
  const ins = `insert into billing_documents(doc_type,client_id,contract_id,recipient_company_name,status,
      spend_amount,markup_type,markup_rate,markup_amount,supply_amount,vat_amount,total_amount)
    values ('settlement',$1,$2,'티키타카',$3,10000000,'rate',12.1,1210000,1100000,110000,1210000) returning id, staff_id`;
  const d = await expectOk('김직원이 정산 승인 요청', () => as('kim', ins, [c1, kid, 'requested']));
  const did = d.rows[0].id;
  await expectBlocked('공급가+세액+차감이 합계와 다르면 저장 안 됨', () =>
    as('kim', `update billing_documents set total_amount=999 where id=$1`, [did]));
  await expectBlocked('차감 금액에 사유가 없으면 저장 안 됨', () =>
    as('kim', `update billing_documents set adjustment_amount=-10000, total_amount=1200000 where id=$1`, [did]));
  await expectOk('사유를 적으면 차감 가능', () =>
    as('kim', `update billing_documents set adjustment_amount=-10000, adjustment_reason='지난달 과청구', total_amount=1200000 where id=$1`, [did]));
  await expectBlocked('직원이 새 문서를 바로 승인 상태로 만들기', () => as('kim', ins, [c1, kid, 'approved']));
  await expectBlocked('직원이 스스로 1차 승인', () =>
    as('kim', `update billing_documents set status='lead_approved' where id=$1`, [did]));
  await expectBlocked('다른 직원이 남의 문서 수정', () =>
    as('lee', `update billing_documents set note='x' where id=$1`, [did]));
  await expectBlocked('팀장이 1차 승인 없이 최종 승인', () =>
    as('lead', `update billing_documents set status='approved' where id=$1`, [did]));
  await expectOk('팀장 1차 승인', () => as('lead', `update billing_documents set status='lead_approved' where id=$1`, [did]));
  await expectBlocked('1차 승인 후 금액 수정', () =>
    as('lead', `update billing_documents set supply_amount=1, total_amount=110001 where id=$1`, [did]));
  await expectBlocked('1차 승인 후 직원이 품목 추가', () =>
    as('kim', `insert into billing_items(billing_document_id,item_name) values ($1,'x')`, [did]));
  await expectBlocked('팀장이 최종 승인 (대표만 가능)', () =>
    as('lead', `update billing_documents set status='approved' where id=$1`, [did]));
  await expectOk('대표 최종 승인', () => as('ceo', `update billing_documents set status='approved' where id=$1`, [did]));
  await expectOk('팀장이 세금계산서 발행 완료 체크', () =>
    as('lead', `update billing_documents set status='issued' where id=$1`, [did]));
  await expectOk('담당자가 입금 확인 체크 → 입금일 자동', async () => {
    await as('kim', `update billing_documents set payment_received=true where id=$1`, [did]);
    const r = await db.query(`select paid_at from billing_documents where id=$1`, [did]);
    if (!r.rows[0].paid_at) throw new Error('입금일 없음');
  });
  await expectOk('승인 기록이 순서대로 남음 (요청 → 1차 → 최종 → 발행)', async () => {
    const r = await db.query(`select to_status from billing_logs where billing_document_id=$1 order by id`, [did]);
    const s = r.rows.map((x) => x.to_status).join(',');
    if (s !== 'requested,lead_approved,approved,issued') throw new Error(s);
  });
  await expectOk('승인자 이름이 기록됨', async () => {
    const r = await db.query(`select l.name a, c.name b from billing_documents d
      join staff l on l.id=d.lead_approved_by join staff c on c.id=d.approved_by where d.id=$1`, [did]);
    if (r.rows[0].a !== '팀장' || r.rows[0].b !== '대표') throw new Error(JSON.stringify(r.rows[0]));
  });

  console.log('반려 후 재요청');
  const d2 = (await as('kim', ins, [c1, kid, 'requested'])).rows[0].id;
  await expectBlocked('사유 없이 반려', () => as('lead', `update billing_documents set status='rejected' where id=$1`, [d2]));
  await expectOk('팀장이 사유를 적어 반려', () =>
    as('lead', `update billing_documents set status='rejected', rejection_reason='증빙 누락' where id=$1`, [d2]));
  await expectOk('반려된 문서는 직원이 금액 수정·품목 수정 가능', async () => {
    await as('kim', `update billing_documents set spend_amount=9000000 where id=$1`, [d2]);
    await as('kim', `insert into billing_items(billing_document_id,item_name,supply_amount,vat_amount,total_amount) values ($1,'광고대행 마크업 비용',1100000,110000,1210000)`, [d2]);
  });
  await expectOk('재요청하면 반려 사유가 지워지고 다시 1차 승인 대기', async () => {
    await as('kim', `update billing_documents set status='requested' where id=$1`, [d2]);
    const r = await db.query(`select status, rejection_reason from billing_documents where id=$1`, [d2]);
    if (r.rows[0].status !== 'requested' || r.rows[0].rejection_reason !== null) throw new Error(JSON.stringify(r.rows[0]));
  });
  await expectOk('반려 사유도 기록에 남음', async () => {
    const r = await db.query(`select reason from billing_logs where billing_document_id=$1 and to_status='rejected'`, [d2]);
    if (r.rows[0]?.reason !== '증빙 누락') throw new Error(JSON.stringify(r.rows));
  });
  await expectOk('대표는 1차 승인 없이 바로 최종 승인 가능', () =>
    as('ceo', `update billing_documents set status='approved' where id=$1`, [d2]));

  console.log('견적');
  const e = (await as('kim', `insert into billing_documents(doc_type,client_id,recipient_company_name,status)
     values ('viral_estimate',$1,'티키타카','requested') returning id`, [c1])).rows[0].id;
  await expectOk('견적은 팀장 확인 한 번으로 끝', () =>
    as('lead', `update billing_documents set status='approved' where id=$1`, [e]));
  await expectBlocked('견적은 세금계산서 발행 단계가 없음', () =>
    as('lead', `update billing_documents set status='issued' where id=$1`, [e]));

  console.log('삭제·보안');
  await expectBlocked('직원이 승인된 문서 삭제', () => as('kim', `delete from billing_documents where id=$1`, [did]));
  await expectBlocked('직원이 승인 기록을 직접 쓰기', () =>
    as('kim', `insert into billing_logs(billing_document_id,to_status) values ($1,'approved')`, [did]));
  await expectBlocked('직원이 발행 사업장 정보 수정', () => as('kim', `update suppliers set bank_account='x' where code='ga'`));
  await expectBlocked('로그인 안 한 사람이 정산 보기', () => as(null, `select * from billing_documents`));
  await expectOk('직원도 정산 목록은 볼 수 있음', async () => {
    const r = await as('lee', `select count(*)::int n from billing_documents`);
    if (r.rows[0].n < 3) throw new Error(String(r.rows[0].n));
  });

  return finish();
}
