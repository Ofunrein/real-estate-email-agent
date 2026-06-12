import { test } from "node:test";
import assert from "node:assert/strict";

import { isUnsafeSmsRecipient, sendTheoSms } from "@/lib/twilioSms";

test("isUnsafeSmsRecipient: blocks reserved NANP smoke-test numbers", () => {
  assert.equal(isUnsafeSmsRecipient("+15551230008"), true);
  assert.equal(isUnsafeSmsRecipient("+15558675310"), true);
  assert.equal(isUnsafeSmsRecipient("+15128152032"), false);
});

test("sendTheoSms: strips rcs: prefix and sends from TWILIO_FROM only", async () => {
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
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_should_not_be_used";

  try {
    const result = await sendTheoSms("rcs:+15128152032", "hello");
    assert.equal(result.sent, true);
    assert.match(requestBody, /To=%2B15128152032/);
    assert.match(requestBody, /From=%2B15128469460/);
    assert.doesNotMatch(requestBody, /MessagingServiceSid/);
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
