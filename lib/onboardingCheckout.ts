import Stripe from "stripe";

export const SERVICE_AGREEMENT_VERSION = "2026-08-27";

export function allowedOnboardingPriceIds(): string[] {
  return [process.env.STRIPE_IRIS_MONTHLY_PRICE_ID, process.env.STRIPE_IRIS_PREMIUM_PRICE_ID]
    .map((value) => value?.trim() || "")
    .filter(Boolean);
}

export function onboardingCheckoutParams(input: {
  priceId: string;
  email?: string;
  origin: string;
}): Stripe.Checkout.SessionCreateParams {
  if (!allowedOnboardingPriceIds().includes(input.priceId)) throw new Error("invalid_price");

  return {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    customer_email: input.email || undefined,
    success_url: `${input.origin}/onboarding/payment-complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/onboarding/agreement`,
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: {
        message: "I agree to the Lumenosis Service Agreement, including scope, billing, non-refundable payments, intellectual property, and termination terms.",
      },
      submit: {
        message: "Payments are non-refundable except where required by law. Service starts after intake and kickoff.",
      },
    },
    metadata: { onboarding: "iris", agreement_version: SERVICE_AGREEMENT_VERSION },
    subscription_data: {
      metadata: { onboarding: "iris", agreement_version: SERVICE_AGREEMENT_VERSION },
    },
  };
}
