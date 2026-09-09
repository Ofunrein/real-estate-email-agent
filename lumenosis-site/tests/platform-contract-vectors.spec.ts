import { expect, test } from "@playwright/test";
import { expectedSignature } from "../lib/platform-auth";

/**
 * Frozen cross-repo signature vectors.
 *
 * The identical vectors live in real-estate-email-agent at
 * tests/ts/platformContractVectors.test.ts. Neither repo may change the signing
 * rules without breaking the other's copy of this test, which is the point: the
 * primary app already has links in the wild signed against this scheme.
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
    expect(
      expectedSignature(SECRET, {
        method: vector.method,
        path: vector.path,
        timestamp: TIMESTAMP,
        nonce: NONCE,
        body: vector.body,
      }),
    ).toBe(vector.signature);
  });
}
