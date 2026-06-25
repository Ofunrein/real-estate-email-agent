import { test } from "node:test";
import assert from "node:assert/strict";

import { sendManualReply } from "@/lib/manualReply";

test("manual Instagram direct send requires a stored Meta page token", async () => {
  const prior = {
    DATABASE_URL: process.env.DATABASE_URL,
    ENABLE_META_SOCIAL_WEBHOOKS: process.env.ENABLE_META_SOCIAL_WEBHOOKS,
    ENABLE_INSTAGRAM_DIRECT_WEBHOOK: process.env.ENABLE_INSTAGRAM_DIRECT_WEBHOOK,
    FACEBOOK_PAGE_ACCESS_TOKEN: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
  };

  delete process.env.DATABASE_URL;
  process.env.ENABLE_META_SOCIAL_WEBHOOKS = "true";
  process.env.ENABLE_INSTAGRAM_DIRECT_WEBHOOK = "true";
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "EAAC_stale_env_token_should_not_be_used";

  try {
    const result = await sendManualReply({
      channel: "instagram",
      to: "lead_123",
      body: "hello",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Connect instagram with Meta before sending/);
      assert.doesNotMatch(result.error, /Malformed access token/i);
    }
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
