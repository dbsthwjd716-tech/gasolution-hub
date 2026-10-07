// 모든 데이터베이스 시험 실행: node supabase/tests/run.mjs
const suites = [
  ['1단계 거래처·권한', './rls.test.mjs'],
  ['2단계 바이럴', './viral.test.mjs'],
  ['바이럴 상품·잔액', './viral-credits.test.mjs'],
  ['3단계 정산·계약', './billing.test.mjs'],
  ['4단계 인입 CRM', './leads.test.mjs'],
];
let failed = 0;
for (const [name, file] of suites) {
  console.log(`\n=== ${name} ===`);
  const { run } = await import(file);
  failed += await run();
}
console.log(failed ? `\n실패 ${failed}건` : '\n모두 통과');
process.exit(failed ? 1 : 0);
