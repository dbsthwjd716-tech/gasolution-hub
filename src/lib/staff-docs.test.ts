import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocKind, missingDocs } from "./staff-docs.ts";

test("빠진 서류: 재직 중은 입사 서류 4종, 퇴사는 퇴직사유서까지", () => {
  assert.deepEqual(missingDocs(["contract", "bankbook"], true), ["nda", "resident"]);
  assert.deepEqual(missingDocs(["contract", "nda", "bankbook", "resident"], false), ["resignation"]);
  assert.deepEqual(missingDocs(["contract", "nda", "bankbook", "resident", "certificate"], true), []);
});

test("서류 종류 확인", () => {
  assert.ok(isDocKind("certificate"));
  assert.ok(!isDocKind("passport"));
});
