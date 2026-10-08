// 모든 데이터베이스 시험 실행: node supabase/tests/run.mjs
const suites = [
  ['1단계 거래처·권한', './rls.test.mjs'],
  ['2단계 바이럴', './viral.test.mjs'],
  ['바이럴 상품·잔액', './viral-credits.test.mjs'],
  ['바이럴 공급가 권한', './viral-cost.test.mjs'],
  ['협력사 견적서', './viral-statements.test.mjs'],
  ['5단계 급여', './payroll.test.mjs'],
  ['3단계 정산·계약', './billing.test.mjs'],
  ['4단계 인입 CRM', './leads.test.mjs'],
  ['예전 CRM 옮기기', './leads-import.test.mjs'],
  ['근태·연차', './attendance.test.mjs'],
  ['주간 프로모션', './promotions.test.mjs'],
  ['직원 화면 미리보기', './view-as.test.mjs'],
  ['본인 급여 보기', './payroll-own.test.mjs'],
];
let failed = 0;
for (const [name, file] of suites) {
  console.log(`\n=== ${name} ===`);
  const { run } = await import(file);
  failed += await run();
}
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
process.exit(failed ? 1 : 0);
