// 문서 날짜에 유효한 계약 고르기 (기간 안 + 가장 최근에 시작한 계약)
export type PickableContract = { id: string; client_id: string; start_date: string | null; end_date: string | null; contract_date: string };

export function pickContract<T extends PickableContract>(contracts: T[], clientId: string, date: string): T | null {
  const ok = contracts.filter(
    (c) => c.client_id === clientId && (!c.start_date || c.start_date <= date) && (!c.end_date || c.end_date >= date),
  );
  ok.sort((a, b) => (b.start_date ?? b.contract_date).localeCompare(a.start_date ?? a.contract_date));
  return ok[0] ?? null;
}
