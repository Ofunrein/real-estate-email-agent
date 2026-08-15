import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { twilioSignatureValid, twilioSignedUrl } from "@/lib/twilioSignature";

const AUTH_TOKEN = "test-auth-token";
const URL_UNDER_TEST = "https://app.example.com/api/webhooks/aria-sms-control";

function sign(url: string, params: Record<string, string>): string {
  const payload = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", AUTH_TOKEN).update(Buffer.from(payload, "utf8")).digest("base64");
}

test("a correctly signed Twilio request is accepted", () => {
  const params = { From: "+15125550123", Body: "status", MessageSid: "SM1" };
  assert.equal(
    twilioSignatureValid({
      url: URL_UNDER_TEST,
      params,
      signature: sign(URL_UNDER_TEST, params),
      authToken: AUTH_TOKEN,
    }),
    true,
  );
});

test("a forged From value invalidates the signature", () => {
  const params = { From: "+15125550123", Body: "status", MessageSid: "SM1" };
  const signature = sign(URL_UNDER_TEST, params);
  assert.equal(
    twilioSignatureValid({
      url: URL_UNDER_TEST,
      params: { ...params, From: "+15125559999" },
      signature,
      authToken: AUTH_TOKEN,
    }),
    false,
  );
});

test("missing signature or auth token never validates", () => {
  const params = { From: "+1", Body: "help" };
  assert.equal(twilioSignatureValid({ url: URL_UNDER_TEST, params, signature: "", authToken: AUTH_TOKEN }), false);
  assert.equal(
    twilioSignatureValid({ url: URL_UNDER_TEST, params, signature: sign(URL_UNDER_TEST, params), authToken: "" }),
    false,
  );
});

test("the signed URL uses the public origin when configured", () => {
  const previous = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://app.example.com";
  try {
    assert.equal(
      twilioSignedUrl("http://10.0.0.5:3000/api/webhooks/aria-sms-control"),
      "https://app.example.com/api/webhooks/aria-sms-control",
    );
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previous;
  }
});
