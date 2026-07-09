import { test } from "node:test";
import assert from "node:assert/strict";

import { sendSms, triggerOutboundCall } from "@/lib/irisCapabilities";

test("sendSms: passes body through untouched (generalized, not property-details-shaped)", async () => {
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

  try {
    const result = await sendSms({
      to: "+15128152032",
      body: "Following up on the job posting you asked about — I'll have someone reach out.",
      channelOrigin: "voice",
    });
    assert.equal(result.sent, true);
    assert.match(decodeURIComponent(requestBody.replace(/\+/g, " ")), /Following up on the job posting/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test("triggerOutboundCall: builds config from env and reports missing Vapi config as a clean error, not a throw", async () => {
  const originalEnv = { ...process.env };
  delete process.env.VAPI_API_KEY;
  delete process.env.VAPI_ASSISTANT_ID;
  delete process.env.VAPI_PHONE_NUMBER_ID;

  try {
    const result = await triggerOutboundCall({ customerNumber: "+15128152032" });
    assert.equal(result.ok, false);
    assert.match(result.error || "", /VAPI_API_KEY|VAPI_ASSISTANT_ID|VAPI_PHONE_NUMBER_ID/);
  } finally {
    process.env = originalEnv;
  }
});

test("triggerOutboundCall: rejects a call with no customer number before ever reaching Vapi", async () => {
  const originalEnv = { ...process.env };
  process.env.VAPI_API_KEY = "k";
  process.env.VAPI_ASSISTANT_ID = "a";
  process.env.VAPI_PHONE_NUMBER_ID = "p";
  const originalFetch = globalThis.fetch;
  let fetchWasCalled = false;
  globalThis.fetch = (async () => {
    fetchWasCalled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await triggerOutboundCall({ customerNumber: "" });
    assert.equal(result.ok, false);
    assert.equal(fetchWasCalled, false, "must not call Vapi with an empty customer number");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
});
