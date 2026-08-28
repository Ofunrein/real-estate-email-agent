import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { kickoffEmailHtml, paidCustomer, verifyStripeSignature } from "../../lib/onboardingCommercial";

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
  assert.deepEqual(paidCustomer({ id: "evt", type: "checkout.session.completed", data: { object: { payment_status: "paid", customer: "cus_1", amount_total: 30000, currency: "usd", customer_details: { email: "client@example.com", name: "A Client" } } } }), {
    email: "client@example.com", name: "A Client", customerId: "cus_1", amount: 30000, currency: "USD",
  });
  assert.equal(paidCustomer({ type: "checkout.session.completed", data: { object: { payment_status: "unpaid", customer_email: "client@example.com" } } }), null);
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
