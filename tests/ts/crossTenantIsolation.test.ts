import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  assertGmailMailboxTenant,
  assertTwilioInboundTenant,
  assertVapiTenant,
  deploymentClientId,
  inngestAppId,
  LEGACY_INNGEST_APP_ID,
  normalizePhoneIdentity,
  twilioInboundNumbers,
} from "@/lib/tenant";
import { signProviderOAuthState, verifyProviderOAuthState } from "@/lib/providerOAuthState";
import { verifyTwilioWebhook } from "@/lib/twilioSignature";
import { parseCallMeta } from "@/lib/vapi";
import { signMediaAccessToken, verifyMediaAccessToken } from "@/lib/mediaUploads";

/**
 * Adversarial cross-tenant suite.
 *
 * Deployment model: one Vercel project + one Neon database per client. Each
 * test here plays the attacker: a provider callback that belongs to client B
 * arriving at client A's deployment, or a caller trying to name a tenant they
 * do not own. Nothing in here asserts happy-path behavior for its own sake.
 */

const CLIENT_A = {
  CLIENT_ID: "acme-realty",
  TWILIO_FROM: "+15125550100",
  TWILIO_AUTH_TOKEN: "acme-auth-token",
  VAPI_ASSISTANT_ID: "asst_acme",
  VAPI_PHONE_NUMBER_ID: "pn_acme",
};

const CLIENT_B = {
  CLIENT_ID: "bravo-homes",
  TWILIO_FROM: "+15125550200",
  TWILIO_AUTH_TOKEN: "bravo-auth-token",
  VAPI_ASSISTANT_ID: "asst_bravo",
  VAPI_PHONE_NUMBER_ID: "pn_bravo",
};

function twilioSignatureFor(url: string, params: Record<string, string>, authToken: string): string {
  const payload = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
}

function withEnv<T>(env: NodeJS.ProcessEnv, run: () => T): T {
  const prior = { ...process.env };
  // Clear the whole state-secret precedence chain first. stateSecret() prefers
  // EMAIL_ACCOUNT_OAUTH_STATE_SECRET, so an ambient value in the developer's
  // shell would otherwise mask the AUTH_SECRET the test is trying to control
  // and quietly make every signature comparison pass.
  delete process.env.EMAIL_ACCOUNT_OAUTH_STATE_SECRET;
  delete process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY;
  delete process.env.AUTH_SECRET;
  delete process.env.CHANNEL_WEBHOOK_SECRET;
  Object.assign(process.env, env);
  try {
    return run();
  } finally {
    process.env = prior;
  }
}

// ---------------------------------------------------------------- Twilio

test("Twilio: a message to another tenant's number is rejected", () => {
  withEnv(CLIENT_A, () => {
    // Client B's number, delivered to client A's webhook.
    const verdict = assertTwilioInboundTenant(CLIENT_B.TWILIO_FROM);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.ok === false && verdict.reason, "mismatch");
  });
});

test("Twilio: our own number is accepted in any common format", () => {
  withEnv(CLIENT_A, () => {
    for (const shape of ["+15125550100", "15125550100", "5125550100", "(512) 555-0100"]) {
      assert.equal(assertTwilioInboundTenant(shape).ok, true, shape);
    }
  });
});

test("Twilio: a Messaging Service sender pool is honored, and only that pool", () => {
  withEnv({ ...CLIENT_A, TWILIO_INBOUND_NUMBERS: "+15125550101,+15125550102" }, () => {
    assert.equal(twilioInboundNumbers().length, 3);
    assert.equal(assertTwilioInboundTenant("+15125550102").ok, true);
    assert.equal(assertTwilioInboundTenant(CLIENT_B.TWILIO_FROM).ok, false);
  });
});

test("Twilio: a signature minted by another tenant's auth token does not validate", () => {
  const url = "https://acme.example.com/api/webhooks/theo-sms";
  const params = { From: "+15125559999", To: CLIENT_A.TWILIO_FROM, Body: "hi" };

  withEnv(CLIENT_A, () => {
    const forged = twilioSignatureFor(url, params, CLIENT_B.TWILIO_AUTH_TOKEN);
    const rejected = verifyTwilioWebhook({ url, params, signature: forged });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.ok === false && rejected.status, 403);

    const genuine = twilioSignatureFor(url, params, CLIENT_A.TWILIO_AUTH_TOKEN);
    assert.equal(verifyTwilioWebhook({ url, params, signature: genuine }).ok, true);
  });
});

test("Twilio: a tampered body invalidates a genuine signature", () => {
  const url = "https://acme.example.com/api/webhooks/theo-sms";
  const original = { From: "+15125559999", To: CLIENT_A.TWILIO_FROM, Body: "hi" };
  withEnv(CLIENT_A, () => {
    const signature = twilioSignatureFor(url, original, CLIENT_A.TWILIO_AUTH_TOKEN);
    const tampered = { ...original, Body: "STOP" };
    assert.equal(verifyTwilioWebhook({ url, params: tampered, signature }).ok, false);
  });
});

test("Twilio: an unconfigured auth token fails closed in production", () => {
  const params = { From: "+1", To: "+2" };
  const url = "https://acme.example.com/api/webhooks/theo-sms";

  const production = verifyTwilioWebhook({ url, params, signature: "x", authToken: "", nodeEnv: "production" });
  assert.equal(production.ok, false);
  assert.equal(production.ok === false && production.status, 503);

  // Local replay harnesses still work outside production.
  assert.equal(verifyTwilioWebhook({ url, params, signature: "x", authToken: "", nodeEnv: "test" }).ok, true);
});

// ------------------------------------------------------------------ Vapi

test("Vapi: a call for another tenant's assistant is rejected", () => {
  withEnv(CLIENT_A, () => {
    const payload = { message: { call: { id: "call_1", assistantId: CLIENT_B.VAPI_ASSISTANT_ID } } };
    const verdict = assertVapiTenant(parseCallMeta(payload));
    assert.equal(verdict.ok, false);
  });
});

test("Vapi: a call on another tenant's phone number id is rejected", () => {
  withEnv(CLIENT_A, () => {
    const payload = {
      message: { call: { id: "call_1", assistantId: CLIENT_A.VAPI_ASSISTANT_ID, phoneNumberId: CLIENT_B.VAPI_PHONE_NUMBER_ID } },
    };
    assert.equal(assertVapiTenant(parseCallMeta(payload)).ok, false);
  });
});

test("Vapi: our own assistant and number pass", () => {
  withEnv(CLIENT_A, () => {
    const payload = {
      message: { call: { id: "call_1", assistantId: CLIENT_A.VAPI_ASSISTANT_ID, phoneNumberId: CLIENT_A.VAPI_PHONE_NUMBER_ID } },
    };
    assert.equal(assertVapiTenant(parseCallMeta(payload)).ok, true);
  });
});

test("Vapi: parseCallMeta reads the identifiers from both payload shapes", () => {
  const expanded = parseCallMeta({
    message: { call: { id: "c1", assistant: { id: "asst_x" }, phoneNumber: { id: "pn_x" } } },
  });
  assert.equal(expanded.assistantId, "asst_x");
  assert.equal(expanded.phoneNumberId, "pn_x");

  const flat = parseCallMeta({ message: { call: { id: "c2", assistantId: "asst_y", phoneNumberId: "pn_y" } } });
  assert.equal(flat.assistantId, "asst_y");
  assert.equal(flat.phoneNumberId, "pn_y");
});

// ----------------------------------------------------------------- Gmail

test("Gmail: a push about another tenant's mailbox is rejected", () => {
  assert.equal(assertGmailMailboxTenant("leads@acme.example.com", "leads@bravo.example.com").ok, false);
  assert.equal(assertGmailMailboxTenant("leads@acme.example.com", "LEADS@ACME.EXAMPLE.COM").ok, true);
});

// ----------------------------------------------------------- OAuth state

test("OAuth state: a hand-rolled unsigned state is refused", () => {
  withEnv({ AUTH_SECRET: "acme-secret" }, () => {
    const forged = Buffer.from(JSON.stringify({ clientId: "victim-tenant" })).toString("base64url");
    assert.throws(() => verifyProviderOAuthState(forged), /Invalid provider OAuth state/);
  });
});

test("OAuth state: a state signed by another deployment's secret is refused", () => {
  const signed = withEnv({ AUTH_SECRET: "bravo-secret" }, () =>
    signProviderOAuthState({ clientId: CLIENT_B.CLIENT_ID, operatorEmail: "op@bravo.example.com" }));

  withEnv({ AUTH_SECRET: "acme-secret" }, () => {
    assert.throws(() => verifyProviderOAuthState(signed), /signature/i);
  });
});

test("OAuth state: flipping the tenant inside a signed payload breaks the signature", () => {
  withEnv({ AUTH_SECRET: "acme-secret" }, () => {
    const signed = signProviderOAuthState({ clientId: CLIENT_A.CLIENT_ID, operatorEmail: "op@acme.example.com" });
    const [payload, signature] = signed.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.clientId = "victim-tenant";
    const swapped = `${Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")}.${signature}`;
    assert.throws(() => verifyProviderOAuthState(swapped), /signature/i);
  });
});

test("OAuth state: an expired state is refused", () => {
  withEnv({ AUTH_SECRET: "acme-secret" }, () => {
    const stale = { clientId: CLIENT_A.CLIENT_ID, operatorEmail: "op@acme.example.com", nonce: "n", iat: Date.now() - 11 * 60 * 1000 };
    const payload = Buffer.from(JSON.stringify(stale), "utf8").toString("base64url");
    const signature = createHmac("sha256", "acme-secret").update(payload).digest("base64url");
    assert.throws(() => verifyProviderOAuthState(`${payload}.${signature}`), /Expired/);
  });
});

// --------------------------------------------------------------- Inngest

test("Inngest: two clients never share an app id", () => {
  const a = withEnv({ CLIENT_ID: CLIENT_A.CLIENT_ID, INNGEST_APP_ID: "" }, () => inngestAppId());
  const b = withEnv({ CLIENT_ID: CLIENT_B.CLIENT_ID, INNGEST_APP_ID: "" }, () => inngestAppId());
  assert.notEqual(a, b);
  assert.match(a, /acme-realty$/);
  assert.match(b, /bravo-homes$/);
});

test("Inngest: the original single-tenant deployment keeps its historical app id", () => {
  // Otherwise upgrading it orphans every function already registered in
  // Inngest Cloud under the old name.
  const legacy = withEnv({ CLIENT_ID: "", INNGEST_APP_ID: "" }, () => inngestAppId());
  assert.equal(legacy, LEGACY_INNGEST_APP_ID);
});

test("Inngest: an explicit app id always wins", () => {
  const explicit = withEnv({ CLIENT_ID: CLIENT_A.CLIENT_ID, INNGEST_APP_ID: "custom-app" }, () => inngestAppId());
  assert.equal(explicit, "custom-app");
});

// -------------------------------------------------------------- Identity

test("deploymentClientId falls back to 'default' but never to another tenant", () => {
  assert.equal(withEnv({ CLIENT_ID: "" }, () => deploymentClientId()), "default");
  assert.equal(withEnv({ CLIENT_ID: "  acme-realty  " }, () => deploymentClientId()), "acme-realty");
});

test("phone identity normalization cannot collapse two different numbers", () => {
  assert.notEqual(normalizePhoneIdentity("+15125550100"), normalizePhoneIdentity("+15125550200"));
  assert.equal(normalizePhoneIdentity("5125550100"), normalizePhoneIdentity("+1 (512) 555-0100"));
});

// ------------------------------------------------------------------ Media

test("Media: a token signed for one tenant does not verify for another", () => {
  // These URLs go to Twilio as an MMS MediaUrl, so the token is what lets an
  // unauthenticated fetcher read the file. It must not be portable.
  const uploadId = "0f8c1b3a-upload";

  const acmeToken = withEnv({ ...CLIENT_A, AUTH_SECRET: "acme-secret" }, () =>
    signMediaAccessToken(uploadId, CLIENT_A.CLIENT_ID));

  withEnv({ ...CLIENT_A, AUTH_SECRET: "acme-secret" }, () => {
    assert.equal(verifyMediaAccessToken(uploadId, acmeToken, CLIENT_A.CLIENT_ID), CLIENT_A.CLIENT_ID);
    // Same token, different tenant claim: refused.
    assert.equal(verifyMediaAccessToken(uploadId, acmeToken, CLIENT_B.CLIENT_ID), "");
    // Different upload id: refused.
    assert.equal(verifyMediaAccessToken("other-upload", acmeToken, CLIENT_A.CLIENT_ID), "");
  });

  // Another deployment's secret cannot mint a token that works here.
  const forged = withEnv({ ...CLIENT_B, AUTH_SECRET: "bravo-secret" }, () =>
    signMediaAccessToken(uploadId, CLIENT_A.CLIENT_ID));
  withEnv({ ...CLIENT_A, AUTH_SECRET: "acme-secret" }, () => {
    assert.equal(verifyMediaAccessToken(uploadId, forged, CLIENT_A.CLIENT_ID), "");
  });
});

test("Media: an empty or garbage token never verifies", () => {
  withEnv({ ...CLIENT_A, AUTH_SECRET: "acme-secret" }, () => {
    assert.equal(verifyMediaAccessToken("id", "", CLIENT_A.CLIENT_ID), "");
    assert.equal(verifyMediaAccessToken("id", "not-a-token", CLIENT_A.CLIENT_ID), "");
  });
});

test("Inngest: the sync script derives the same app id as the runtime", () => {
  // scripts/inngest-sync.mjs re-implements inngestAppId() so it can stay a plain
  // node script. If the two ever disagree, a deployment registers under one id
  // and serves under another, and its functions silently never run.
  const script = readFileSync(new URL("../../scripts/inngest-sync.mjs", import.meta.url), "utf8");
  assert.match(script, new RegExp(LEGACY_INNGEST_APP_ID));

  for (const clientId of ["", "default", "acme-realty"]) {
    const expected = withEnv({ CLIENT_ID: clientId, INNGEST_APP_ID: "" }, () => inngestAppId());
    const fromScript = clientId && clientId !== "default"
      ? `${LEGACY_INNGEST_APP_ID}-${clientId}`
      : LEGACY_INNGEST_APP_ID;
    assert.equal(expected, fromScript, `client=${clientId || "(unset)"}`);
  }
});
