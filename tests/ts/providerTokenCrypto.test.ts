import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptProviderTokenAtRest, encryptProviderTokenAtRest } from "@/lib/emailAccountCrypto";

/**
 * Meta Page and TikTok advertiser tokens were stored in plaintext in
 * channel_connections.page_access_token, so any database read produced a usable
 * credential. Encryption happens at the storage boundary in lib/database.ts.
 *
 * The transparency properties matter as much as the round trip: this ships
 * without a backfill, so existing plaintext rows must keep working and must be
 * re-encrypted on their next write.
 */

test("provider token round-trips, is idempotent, and tolerates legacy plaintext", () => {
  const prior = { ...process.env };
  process.env.AUTH_SECRET = "round-trip-secret";
  try {
    const plain = "EAAG_page_token_value";
    const enc = encryptProviderTokenAtRest(plain);
    assert.notEqual(enc, plain);
    assert.equal(decryptProviderTokenAtRest(enc), plain);
    // Re-encrypting an already-encrypted value must not double-wrap.
    assert.equal(encryptProviderTokenAtRest(enc), enc);
    // Rows written before this change are plaintext and must still read.
    assert.equal(decryptProviderTokenAtRest(plain), plain);
    assert.equal(encryptProviderTokenAtRest(""), "");
    assert.equal(decryptProviderTokenAtRest(""), "");
  } finally {
    process.env = prior;
  }
});

test("a token encrypted under a different secret decrypts to empty, not garbage", () => {
  const prior = { ...process.env };
  try {
    process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY = "";
    process.env.AUTH_SECRET = "secret-a";
    const enc = encryptProviderTokenAtRest("token-value");
    process.env.AUTH_SECRET = "secret-b";
    assert.equal(decryptProviderTokenAtRest(enc), "");
  } finally {
    process.env = prior;
  }
});
