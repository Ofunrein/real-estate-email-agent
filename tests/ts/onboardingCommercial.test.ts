import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { kickoffEmailHtml, paidCustomer, sendKickoffEmail, sendKickoffSms, verifyStripeSignature } from "../../lib/onboardingCommercial";

test("verifies Stripe signatures and rejects stale signatures", () => {
  const body = JSON.stringify({ id: "evt_1" });
  const now = Date.now();
  const timestamp = Math.floor(now / 1000);
  const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.${body}`).digest("hex");
  const header = `t=${timestamp},v1=${signature}`;
  assert.equal(verifyStripeSignature(body, header, "whsec_test", now), true);
  assert.equal(verifyStripeSignature(body + " ", header, "whsec_test", now), false);
  assert.equal(verifyStripeSignature(body, header, "whsec_test", now + 301_000), false);
});

test("extracts only paid checkout customers", () => {
  assert.deepEqual(paidCustomer({ id: "evt", type: "checkout.session.completed", data: { object: { payment_status: "paid", customer: "cus_1", amount_total: 30000, currency: "usd", customer_details: { email: "client@example.com", name: "A Client", phone: "+15125550123" }, metadata: { company_name: "Client Realty", plan: "growth", agreement_version: "2026-09", onboarding_sms_consent: "true" } } } }), {
    email: "client@example.com", name: "A Client", phone: "+15125550123", companyName: "Client Realty", plan: "growth", agreementVersion: "2026-09", smsConsent: true, customerId: "cus_1", amount: 30000, currency: "USD",
  });
  assert.equal(paidCustomer({ type: "checkout.session.completed", data: { object: { payment_status: "unpaid", customer_email: "client@example.com" } } }), null);
  assert.equal(paidCustomer({ type: "invoice.paid", data: { object: { billing_reason: "subscription_cycle", customer_email: "client@example.com" } } }), null);
});

test("kickoff email includes intake, scheduling, and secure-access guidance", () => {
  const html = kickoffEmailHtml({ name: "A & B", intakeUrl: "https://example.com/intake", bookingUrl: "https://example.com/book" });
  assert.match(html, /A &amp; B/);
  assert.match(html, /Complete onboarding form/);
  assert.match(html, /Schedule kickoff call/);
  assert.match(html, /Do not email passwords or API keys/);
  assert.match(html, /lumenosis-logo-warm-rounded\.png/);
  assert.match(html, /Olivia/);
  assert.doesNotMatch(html, /<p>Martin<br>/);
});

test("Resend remains the only onboarding email provider even when AgentMail is configured", async () => {
  process.env.AGENTMAIL_API_KEY = "example-agentmail-key";
  process.env.RESEND_API_KEY = "example-resend-key";
  process.env.TYPEFORM_ONBOARDING_URL = "https://example.com/intake";
  process.env.ONBOARDING_KICKOFF_BOOKING_URL = "https://example.com/book";
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  };
  const result = await sendKickoffEmail({ to: "client@example.com", name: "A Client" }, fetchImpl as typeof fetch);
  assert.equal(result, "re_1");
  assert.equal(calls[0].url, "https://api.resend.com/emails");
});

test("onboarding SMS requires explicit Stripe consent", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }); };
  assert.deepEqual(await sendKickoffSms({ to: "+15125550123", name: "A Client", consent: false }, fetchImpl as typeof fetch), { skipped: true, id: "" });
  assert.equal(called, false);
});

test("onboarding SMS never borrows the production Iris sender", async () => {
  process.env.TWILIO_ACCOUNT_SID = "ACexample";
  process.env.TWILIO_AUTH_TOKEN = "example-token";
  process.env.TWILIO_FROM = "+15128469460";
  delete process.env.ONBOARDING_TWILIO_FROM;
  delete process.env.ONBOARDING_TWILIO_MESSAGING_SERVICE_SID;
  process.env.ONBOARDING_KICKOFF_BOOKING_URL = "https://example.com/book";
  let called = false;
  const result = await sendKickoffSms({ to: "+15125550123", name: "A Client", consent: true }, (async () => {
    called = true;
    return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
  }) as typeof fetch);
  assert.deepEqual(result, { skipped: true, id: "" });
  assert.equal(called, false);
});
