import "server-only";
import { createSign } from "node:crypto";

// 구글 서비스 계정으로 시트 읽기 (읽기 전용 권한). 기존 대시보드와 같은 환경변수를 씀
//   GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY, VIRAL_GOOGLE_SHEET_ID

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

async function accessToken(): Promise<string> {
  const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const key = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("구글 시트 연결 정보(GOOGLE_SHEETS_CLIENT_EMAIL / PRIVATE_KEY)가 없습니다.");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${b64url(signer.sign(key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error("구글 인증에 실패했습니다.");
  return data.access_token as string;
}

// 여러 탭을 한 번에 읽음. 반환: 탭 이름 → 2행부터의 줄 목록
export async function readTabs(spreadsheetId: string, tabs: readonly string[], lastCol = "R") {
  const token = await accessToken();
  const params = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" });
  for (const t of tabs) params.append("ranges", `'${t}'!A2:${lastCol}`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  const data = await res.json();
  if (!res.ok) throw new Error("시트를 읽지 못했습니다: " + (data?.error?.message ?? res.status));
  const out: Record<string, string[][]> = {};
  (data.valueRanges as { values?: string[][] }[]).forEach((vr, i) => {
    out[tabs[i]] = vr.values ?? [];
  });
  return out;
}
