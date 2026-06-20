import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/webhooks/theo-social-router/route";

function request(body: Record<string, unknown>, headers: Record<string, string> = {}, query = "") {
  return new NextRequest(`http://local.test/api/webhooks/theo-social-router${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("theo social router: rejects invalid secret", async () => {
  const priorSecret = process.env.CHANNEL_WEBHOOK_SECRET;
  process.env.CHANNEL_WEBHOOK_SECRET = "secret";
  const response = await POST(request({ channel: "instagram", message_text: "price?", contact_id: "1" }, { "x-lumenosis-webhook-secret": "bad" }));
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.ok, false);
  if (priorSecret == null) delete process.env.CHANNEL_WEBHOOK_SECRET;
  else process.env.CHANNEL_WEBHOOK_SECRET = priorSecret;
});

test("theo social router: disabled mode skips without DB writes", async () => {
  const priorSecret = process.env.CHANNEL_WEBHOOK_SECRET;
  const priorEnabled = process.env.ENABLE_SOCIAL_DM_AGENT;
  process.env.CHANNEL_WEBHOOK_SECRET = "secret";
  delete process.env.ENABLE_SOCIAL_DM_AGENT;
  const response = await POST(request(
    { channel: "messenger", message_text: "Is it available?", contact_id: "2", route_reason: "listing_question" },
    { "x-lumenosis-webhook-secret": "secret" },
  ));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.should_send, false);
  assert.equal(body.status, "skipped");
  if (priorSecret == null) delete process.env.CHANNEL_WEBHOOK_SECRET;
  else process.env.CHANNEL_WEBHOOK_SECRET = priorSecret;
  if (priorEnabled == null) delete process.env.ENABLE_SOCIAL_DM_AGENT;
  else process.env.ENABLE_SOCIAL_DM_AGENT = priorEnabled;
});

test("theo social router: disabled ManyChat format returns empty messages", async () => {
  const priorEnabled = process.env.ENABLE_SOCIAL_DM_AGENT;
  delete process.env.CHANNEL_WEBHOOK_SECRET;
  delete process.env.ENABLE_SOCIAL_DM_AGENT;
  const response = await POST(request(
    { channel: "instagram", message_text: "Can you send photos?", contact_id: "3", route_reason: "listing_question" },
    {},
    "?format=manychat",
  ));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, "v2");
  assert.equal(body.content.type, "instagram");
  assert.deepEqual(body.content.messages, []);
  if (priorEnabled == null) delete process.env.ENABLE_SOCIAL_DM_AGENT;
  else process.env.ENABLE_SOCIAL_DM_AGENT = priorEnabled;
});
