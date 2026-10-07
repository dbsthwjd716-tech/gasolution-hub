// 구글 서비스 계정 키를 Vercel 환경변수에 어떤 모양으로 붙여 넣었든 읽을 수 있게 정리한다.
// 흔한 경우: 앞뒤 따옴표가 같이 들어감, 줄바꿈이 \n 글자로 들어감(한 번 또는 두 번), 윈도우 줄바꿈(\r\n),
// JSON 키 파일 내용을 통째로 붙여 넣음, 머리글(BEGIN/END) 없이 본문만 넣음, 중간에 공백이 섞임.
import { createPrivateKey } from "node:crypto";

export type ServiceAccount = { clientEmail: string; privateKey: string };

function stripQuotes(v: string) {
  let s = v.trim();
  while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s.replace(/,$/, "").trim();
}

export function normalizePrivateKey(raw: string): string {
  let s = stripQuotes(raw);
  // "private_key": "..." 형태로 붙여 넣은 경우
  const m = s.match(/"?private_key"?\s*:\s*"([\s\S]+?)"\s*,?\s*$/);
  if (m) s = m[1];
  s = s.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\r/g, "");
  const body = s
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "")
    .replace(/-----END [A-Z ]*PRIVATE KEY-----/, "")
    .replace(/[^A-Za-z0-9+/=]/g, ""); // 줄바꿈·공백·따옴표 등 제거
  const kind = /BEGIN RSA PRIVATE KEY/.test(s) ? "RSA PRIVATE KEY" : "PRIVATE KEY";
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${kind}-----\n${lines.join("\n")}\n-----END ${kind}-----\n`;
}

// 환경변수에서 서비스 계정 정보를 꺼냄. PRIVATE_KEY 칸에 JSON 파일 전체를 넣어도 동작
export function readServiceAccount(env: Record<string, string | undefined>): ServiceAccount {
  const rawKey = env.GOOGLE_SHEETS_PRIVATE_KEY ?? "";
  let clientEmail = stripQuotes(env.GOOGLE_SHEETS_CLIENT_EMAIL ?? "");
  let keyText = rawKey;
  const trimmed = stripQuotes(rawKey);
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      keyText = json.private_key ?? "";
      if (!clientEmail && json.client_email) clientEmail = json.client_email;
    } catch {
      /* JSON이 아니면 그대로 */
    }
  }
  if (!clientEmail) throw new Error("GOOGLE_SHEETS_CLIENT_EMAIL 값이 비어 있습니다.");
  if (!/@.+\.iam\.gserviceaccount\.com$/.test(clientEmail))
    throw new Error("GOOGLE_SHEETS_CLIENT_EMAIL 값이 서비스 계정 주소(...iam.gserviceaccount.com) 모양이 아닙니다.");
  if (!keyText.trim()) throw new Error("GOOGLE_SHEETS_PRIVATE_KEY 값이 비어 있습니다.");
  const privateKey = normalizePrivateKey(keyText);
  try {
    createPrivateKey(privateKey);
  } catch {
    throw new Error(
      "GOOGLE_SHEETS_PRIVATE_KEY 값을 키로 읽을 수 없습니다. JSON 파일의 private_key 값을 처음부터 끝까지 다시 복사해 넣어 주세요.",
    );
  }
  return { clientEmail, privateKey };
}
