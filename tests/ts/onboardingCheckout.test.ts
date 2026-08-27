import assert from "node:assert/strict";
import test from "node:test";
import { onboardingCheckoutParams, SERVICE_AGREEMENT_VERSION } from "../../lib/onboardingCheckout";

test("checkout requires the service agreement and records its version", () => {
  process.env.STRIPE_IRIS_MONTHLY_PRICE_ID = "price_starter";
  const params = onboardingCheckoutParams({
    priceId: "price_starter",
    email: "buyer@example.com",
    origin: "https://app.lumenosis.com",
  });

  assert.equal(params.mode, "subscription");
  assert.equal(params.consent_collection?.terms_of_service, "required");
  assert.equal(params.metadata?.agreement_version, SERVICE_AGREEMENT_VERSION);
  const submitText = params.custom_text && params.custom_text.submit ? params.custom_text.submit.message : "";
  assert.match(submitText || "", /non-refundable/i);
  assert.equal(params.success_url, "https://app.lumenosis.com/onboarding/payment-complete?session_id={CHECKOUT_SESSION_ID}");
});

test("checkout rejects unknown prices", () => {
  process.env.STRIPE_IRIS_MONTHLY_PRICE_ID = "price_starter";
  assert.throws(
    () => onboardingCheckoutParams({ priceId: "price_unknown", origin: "https://app.lumenosis.com" }),
    /invalid_price/,
  );
});
