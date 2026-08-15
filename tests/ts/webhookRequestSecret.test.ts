import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { assertWebhookSecret, constantTimeSecretEqual } from "@/lib/webhookRequest";

function webhookRequest(headers: Record<string, string> = {}, url = "https://app.example.com/api/webhooks/theo-sms") {
  return new NextRequest(new Request(url, { method: "POST", headers }));
}

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.keys(values).map((key) => [key, process.env[key]] as const);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("a matching header secret is accepted", () => {
  withEnv({ CHANNEL_WEBHOOK_SECRET: "s3cret-value" }, () => {
    assert.doesNotThrow(() => assertWebhookSecret(webhookRequest({ "x-lumenosis-webhook-secret": "s3cret-value" })));
  });
});

test("a wrong or absent secret is rejected", () => {
  withEnv({ CHANNEL_WEBHOOK_SECRET: "s3cret-value" }, () => {
    assert.throws(() => assertWebhookSecret(webhookRequest({ "x-lumenosis-webhook-secret": "wrong" })), /Invalid webhook secret/);
    assert.throws(() => assertWebhookSecret(webhookRequest()), /Invalid webhook secret/);
  });
});

test("an unconfigured secret fails closed in production", () => {
  withEnv({ CHANNEL_WEBHOOK_SECRET: undefined, NODE_ENV: "production" }, () => {
    assert.throws(() => assertWebhookSecret(webhookRequest()), /not configured/);
  });
});

test("an unconfigured secret stays permissive outside production", () => {
  withEnv({ CHANNEL_WEBHOOK_SECRET: undefined, NODE_ENV: "test" }, () => {
    assert.doesNotThrow(() => assertWebhookSecret(webhookRequest()));
  });
});

test("secret comparison is length-safe and rejects empty expectations", () => {
  assert.equal(constantTimeSecretEqual("abc", "abc"), true);
  assert.equal(constantTimeSecretEqual("abc", "abcd"), false);
  assert.equal(constantTimeSecretEqual("", ""), false);
});
