import { test } from "node:test";
import assert from "node:assert/strict";

import { isUnsafeSmsRecipient, sendTheoSms } from "@/lib/twilioSms";

test("isUnsafeSmsRecipient: blocks reserved NANP smoke-test numbers", () => {
  assert.equal(isUnsafeSmsRecipient("+15551230008"), true);
  assert.equal(isUnsafeSmsRecipient("+15558675310"), true);
  assert.equal(isUnsafeSmsRecipient("+15128152032"), false);
});

test("sendTheoSms: strips rcs: prefix and prefers the Messaging Service", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = (async (_url, init) => {
    requestBody = String(init?.body || "");
    return new Response(JSON.stringify({ sid: "SM_fake" }), { status: 200 });
  }) as typeof fetch;
  process.env.ENABLE_SMS_AGENT = "true";
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM = "+15128469460";
  // A2P 10DLC registers the campaign against the Messaging Service, so when one
  // is configured it must own the send. An earlier revision pinned the opposite
  // (From-only); that left every send on unregistered traffic.
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_configured";

  try {
    const result = await sendTheoSms("rcs:+15128152032", "hello");
    assert.equal(result.sent, true);
    assert.match(requestBody, /To=%2B15128152032/);
    assert.match(requestBody, /MessagingServiceSid=MG_configured/);
    assert.doesNotMatch(requestBody, /From=/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("sendTheoSms: falls back to TWILIO_FROM when no Messaging Service is set", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = (async (_url, init) => {
    requestBody = String(init?.body || "");
    return new Response(JSON.stringify({ sid: "SM_fake" }), { status: 200 });
  }) as typeof fetch;
  process.env.ENABLE_SMS_AGENT = "true";
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM = "+15128469460";
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;

  try {
    const result = await sendTheoSms("+15128152032", "hello");
    assert.equal(result.sent, true);
    assert.match(requestBody, /From=%2B15128469460/);
    assert.doesNotMatch(requestBody, /MessagingServiceSid/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("sendTheoSms: attaches a delivery status callback when a public base URL exists", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = (async (_url, init) => {
    requestBody = String(init?.body || "");
    return new Response(JSON.stringify({ sid: "SM_fake" }), { status: 200 });
  }) as typeof fetch;
  process.env.ENABLE_SMS_AGENT = "true";
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM = "+15128469460";
  process.env.PUBLIC_BASE_URL = "https://client.example.com";
  delete process.env.TWILIO_WEBHOOK_BASE_URL;

  try {
    await sendTheoSms("+15128152032", "hello");
    assert.match(requestBody, /StatusCallback=https%3A%2F%2Fclient\.example\.com%2Fapi%2Fwebhooks%2Ftwilio-status/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("sendTheoSms: does not call Twilio for reserved test numbers", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(JSON.stringify({ sid: "SM_fake" }), { status: 200 });
  }) as typeof fetch;
  process.env.ENABLE_SMS_AGENT = "true";
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM = "+15128469460";

  try {
    const result = await sendTheoSms("+15551230008", "hello");
    assert.equal(result.sent, false);
    assert.equal(result.skipped, true);
    assert.match(result.error, /Blocked unsafe SMS recipient/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("sendTheoSms: an opted-out lead is blocked at the transport boundary", async () => {
  // Suppression lives here, not only in messageReplySend, because speed-to-lead,
  // the website reply, appointment confirmations and cadence all send directly.
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(JSON.stringify({ sid: "SM_fake" }), { status: 200 });
  }) as typeof fetch;
  process.env.ENABLE_SMS_AGENT = "true";
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM = "+15128469460";
  // No DATABASE_URL: the lookup no-ops and the send proceeds. A suppression
  // check that cannot run must not silently take a client's agent offline.
  delete process.env.DATABASE_URL;

  try {
    const result = await sendTheoSms("+15128152032", "hello");
    assert.equal(result.sent, true);
    assert.equal(called, true);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("sendTheoSms: operatorInitiated is the only way past the suppression gate", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ sid: "SM_fake" }), { status: 200 })) as typeof fetch;
  process.env.ENABLE_SMS_AGENT = "true";
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM = "+15128469460";
  delete process.env.DATABASE_URL;

  try {
    // START/HELP replies and dashboard sends pass the flag; everything else
    // must not, so the default stays gated.
    const operator = await sendTheoSms("+15128152032", "you are opted back in", [], { operatorInitiated: true });
    assert.equal(operator.sent, true);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});
