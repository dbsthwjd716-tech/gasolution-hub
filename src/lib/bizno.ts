// 사업자번호: 데이터베이스 규칙(is_valid_business_number)과 같은 계산을 화면에서도 미리 해서
// 저장 전에 알기 쉬운 안내를 띄움

export function normalizeBizNo(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length ? digits : null;
}

export function isValidBizNo(bn: string | null): boolean {
  if (!bn || !/^\d{10}$/.test(bn)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const d = bn.split("").map(Number);
  let s = 0;
  for (let i = 0; i < 9; i++) s += d[i] * w[i];
  s += Math.floor((d[8] * 5) / 10);
  return (10 - (s % 10)) % 10 === d[9];
}

export function formatBizNo(bn: string | null): string {
  if (!bn || !/^\d{10}$/.test(bn)) return "";
  return `${bn.slice(0, 3)}-${bn.slice(3, 5)}-${bn.slice(5)}`;
}

// 저장할 값 확인. 비어 있으면 임시 거래처(null), 형식이 틀리면 안내 문구
export function checkBizNo(raw: string | null | undefined):
  | { ok: true; value: string | null }
  | { ok: false; message: string } {
  const bn = normalizeBizNo(raw);
  if (bn === null) return { ok: true, value: null };
  if (bn.length !== 10) return { ok: false, message: "사업자번호는 숫자 10자리입니다." };
  if (!isValidBizNo(bn))
    return { ok: false, message: "사업자번호가 맞지 않습니다. 숫자를 다시 확인해 주세요." };
  return { ok: true, value: bn };
}
