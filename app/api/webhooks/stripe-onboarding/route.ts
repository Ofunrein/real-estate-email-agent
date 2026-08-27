import { NextRequest, NextResponse } from "next/server";
import { claimCommercialEvent, finishCommercialEvent } from "@/lib/onboardingDatabase";
import { paidCustomer, sendKickoffEmail, verifyStripeSignature, type StripeEvent } from "@/lib/onboardingCommercial";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  const secret = process.env.STRIPE_ONBOARDING_WEBHOOK_SECRET || "";
  if (!verifyStripeSignature(raw, signature, secret)) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as StripeEvent;
  if (!event.id || !event.type) return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });
  const customer = paidCustomer(event);
  if (!customer) return NextResponse.json({ ok: true, ignored: true });

  const claimed = await claimCommercialEvent({
    eventId: event.id,
    eventType: event.type,
    customerId: customer.customerId,
    customerEmail: customer.email,
    amount: customer.amount,
    currency: customer.currency,
  });
  if (!claimed) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const emailId = await sendKickoffEmail({ to: customer.email, name: customer.name });
    await finishCommercialEvent(event.id, "complete", emailId);
    return NextResponse.json({ ok: true, emailId });
  } catch (error) {
    await finishCommercialEvent(event.id, "failed", "", String(error).slice(0, 500));
    throw error;
  }
}
