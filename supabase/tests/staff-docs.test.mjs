// 직원 서류함: 대표·팀장은 전부, 직원은 본인 것만 보기·올리기, 지우기는 대표·팀장
import { setup } from './_db.mjs';

export async function run() {
  const { db, as, expectOk, expectBlocked, finish } = await setup();
  const id = async (n) => (await db.query(`select id from staff where name=$1`, [n])).rows[0].id;
  const kim = await id('김직원'), lee = await id('이직원');
  let doc;
  await expectOk('직원이 본인 통장사본 올리기', async () => {
    doc = (await as('kim', `insert into staff_documents(staff_id, kind, storage_path, file_name) values ($1,'bankbook',$2,'통장.pdf') returning id`, [kim, kim + '/2026-10/a.pdf'])).rows[0].id;
  });
  await expectBlocked('직원이 다른 직원 서류 올리기', () => as('kim', `insert into staff_documents(staff_id, kind, storage_path, file_name) values ($1,'other',$2,'x.pdf')`, [lee, lee + '/2026-10/b.pdf']));
  await expectBlocked('보관함 경로가 직원 폴더가 아니면 안 됨', () => as('lead', `insert into staff_documents(staff_id, kind, storage_path, file_name) values ($1,'other','etc/c.pdf','x.pdf')`, [kim]));
  await expectOk('팀장이 직원 근로계약서 올리기', () => as('lead', `insert into staff_documents(staff_id, kind, storage_path, file_name) values ($1,'contract',$2,'계약.pdf')`, [lee, lee + '/2026-10/c.pdf']));
  await expectOk('다른 직원에게는 안 보임', async () => {
    const x = await as('lee', `select kind from staff_documents`);
    if (x.rows.length !== 1 || x.rows[0].kind !== 'contract') throw new Error(JSON.stringify(x.rows));
  });
  await expectBlocked('직원이 본인 서류 지우기', async () => {
    const x = await as('kim', `delete from staff_documents where id=$1 returning id`, [doc]);
    if (!x.rows.length) throw new Error('막힘');
  });
  await expectOk('본인 열람 기록 남기기', () => as('kim', `insert into staff_document_views(document_id) values ($1)`, [doc]));
  await expectBlocked('남의 서류 열람 기록', () => as('lee', `insert into staff_document_views(document_id) values ($1)`, [doc]));
  await expectOk('열람 기록은 직원에게 안 보임, 팀장은 보임', async () => {
    if ((await as('kim', `select * from staff_document_views`)).rows.length) throw new Error('직원에게 보임');
    if ((await as('lead', `select * from staff_document_views`)).rows.length !== 1) throw new Error('팀장에게 안 보임');
  });
  await expectOk('팀장이 지우기', async () => {
    const x = await as('lead', `delete from staff_documents where id=$1 returning id`, [doc]);
    if (!x.rows.length) throw new Error('안 지워짐');
  });
  return finish();
}
