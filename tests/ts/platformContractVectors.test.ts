import assert from "node:assert/strict";
import { test } from "node:test";

import { signedHeaders } from "@/lib/demoAdminClient";

/**
 * Frozen cross-repo signature vectors.
 *
 * The identical vectors live in lumenosis-site at
 * tests/platform-contract-vectors.spec.ts, asserted there against the real
 * verifier. Neither repo may change the signing rules without breaking the
 * other's copy of this test.
 *
 * The secret is a placeholder, not a credential.
 */

const SECRET = "example-platform-signing-key-not-real-32";
const TIMESTAMP = "1760000000000";
const NONCE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const VECTORS = [
  {
    method: "GET",
    path: "/api/platform/demos",
    body: "",
    signature: "e1fa63b8ab042c10a1a40217c5a33c6f23ecd89aaccb8d1386caa37463fada84",
  },
  {
    method: "POST",
    path: "/api/platform/demos/room-1/approve",
    body: "{}",
    signature: "df7efa36abe0f23670eed827f30711b55fe2ca30e8ad451ecf4c258ea192d4be",
  },
  {
    method: "POST",
    path: "/api/platform/demos/room-1/send",
    body: "{}",
    signature: "b69db062868b67c59826f076d15e15a3b6552b1f76a5ef66b2f022450814c682",
  },
] as const;

for (const vector of VECTORS) {
  test(`frozen vector: ${vector.method} ${vector.path}`, () => {
    const headers = signedHeaders({
      secret: SECRET,
      method: vector.method,
      path: vector.path,
      body: vector.body,
      timestamp: TIMESTAMP,
      nonce: NONCE,
    });
    assert.equal(headers["x-lumenosis-signature"], vector.signature);
    assert.equal(headers["x-lumenosis-timestamp"], TIMESTAMP);
    assert.equal(headers["x-lumenosis-nonce"], NONCE);
    assert.equal(headers["content-type"], "application/json");
  });
}

test("the placeholder secret never appears in signed output", () => {
  const headers = signedHeaders({
    secret: SECRET,
    method: "GET",
    path: "/api/platform/demos",
    body: "",
  });
  assert.equal(JSON.stringify(headers).includes(SECRET), false);
});
