import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { missingIntakeFields, normalizeTypeformResponse, verifyTypeformSignature, type TypeformWebhook } from "@/lib/onboarding";
import { upsertOnboardingIntake } from "@/lib/onboardingDatabase";
import { deploymentClientId } from "@/lib/tenant";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const secret = process.env.TYPEFORM_WEBHOOK_SECRET || "";
  if (!verifyTypeformSignature(raw, request.headers.get("typeform-signature") || "", secret)) return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  const payload = JSON.parse(raw) as TypeformWebhook;
  const expectedForm = process.env.TYPEFORM_ONBOARDING_FORM_ID || "v3hPCHwT";
  if (payload.form_response?.form_id !== expectedForm) return NextResponse.json({ ok: false, error: "wrong_form" }, { status: 403 });
  const responseId = payload.form_response.token || payload.event_id || "";
  if (!responseId) return NextResponse.json({ ok: false, error: "missing_response_id" }, { status: 400 });
  const intake = normalizeTypeformResponse(payload);
  const missingFields = missingIntakeFields(intake);
  const clientId = payload.form_response.hidden?.client_id || deploymentClientId();
  const session = await upsertOnboardingIntake({ clientId, responseId, idempotencyKey: `typeform:${responseId}`, intake, missingFields, submittedAt: payload.form_response.submitted_at });
  await inngest.send({ name: "client.onboarding.intake.completed", data: { clientId, sessionId: session.id, responseId, intake, missingFields } });
  return NextResponse.json({ ok: true, sessionId: session.id, state: missingFields.length ? "blocked" : "intake_complete" });
}
