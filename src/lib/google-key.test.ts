// 구글 키를 여러 모양으로 붙여 넣어도 읽히는지 시험 (시험용으로 그때그때 만든 가짜 키 사용)
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, createVerify } from "node:crypto";
import { normalizePrivateKey, readServiceAccount } from "./google-key.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const EMAIL = "sheets-reader@my-project.iam.gserviceaccount.com";
const escaped = JSON.stringify(privateKey).slice(1, -1); // JSON 파일 안의 모양: 줄바꿈이 \n 글자

function signsWith(pem: string) {
  const s = createSign("RSA-SHA256");
  s.update("hello");
  const sig = s.sign(pem);
  const v = createVerify("RSA-SHA256");
  v.update("hello");
  return v.verify(publicKey, sig);
}

const variants: Record<string, string> = {
  "진짜 줄바꿈": privateKey,
  "\\n 글자 (JSON에서 복사)": escaped,
  "앞뒤 따옴표 포함": `"${escaped}"`,
  "따옴표+쉼표까지": `"${escaped}",`,
  "\\n이 두 번 이스케이프": escaped.replace(/\\n/g, "\\\\n"),
  "윈도우 줄바꿈": privateKey.replace(/\n/g, "\r\n"),
  "\"private_key\": 줄까지 복사": `"private_key": "${escaped}",`,
  "머리글 없이 본문만": privateKey.replace(/-----[A-Z ]+-----/g, "").trim(),
  "한 줄로 공백 섞임": privateKey.replace(/\n/g, " "),
};

for (const [name, v] of Object.entries(variants)) {
  test(`키 붙여 넣기: ${name}`, () => {
    assert.ok(signsWith(normalizePrivateKey(v)));
    const sa = readServiceAccount({ GOOGLE_SHEETS_CLIENT_EMAIL: EMAIL, GOOGLE_SHEETS_PRIVATE_KEY: v });
    assert.equal(sa.clientEmail, EMAIL);
  });
}

test("PRIVATE_KEY 칸에 JSON 파일 전체를 넣어도 이메일·키를 모두 꺼냄", () => {
  const json = JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: privateKey });
  const sa = readServiceAccount({ GOOGLE_SHEETS_PRIVATE_KEY: json });
  assert.equal(sa.clientEmail, EMAIL);
  assert.ok(signsWith(sa.privateKey));
});

test("잘린 키는 알기 쉬운 안내로 거절 (키 내용은 메시지에 넣지 않음)", () => {
  assert.throws(
    () => readServiceAccount({ GOOGLE_SHEETS_CLIENT_EMAIL: EMAIL, GOOGLE_SHEETS_PRIVATE_KEY: escaped.slice(0, 300) }),
    (e: Error) => /다시 복사/.test(e.message) && !e.message.includes(escaped.slice(40, 80)),
  );
});

test("이메일 칸에 엉뚱한 값이 들어가면 안내", () => {
  assert.throws(() => readServiceAccount({ GOOGLE_SHEETS_CLIENT_EMAIL: "1-KbK25cXw4", GOOGLE_SHEETS_PRIVATE_KEY: privateKey }), /서비스 계정 주소/);
});
