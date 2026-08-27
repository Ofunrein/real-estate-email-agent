import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { onboardingCheckoutParams } from "@/lib/onboardingCheckout";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY || "";
  if (!secret) return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as { priceId?: string; email?: string };
  const priceId = body.priceId?.trim() || "";
  const email = body.email?.trim() || "";
  const origin = (process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || request.nextUrl.origin).replace(/\/$/, "");

  try {
    const stripe = new Stripe(secret);
    const session = await stripe.checkout.sessions.create(onboardingCheckoutParams({ priceId, email, origin }));
    if (!session.url) throw new Error("checkout_url_missing");
    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (String(error).includes("invalid_price")) {
      return NextResponse.json({ error: "invalid_price" }, { status: 400 });
    }
    console.error("Unable to create onboarding checkout", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}
