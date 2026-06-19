import { NextRequest, NextResponse } from "next/server";

import { clientConfig } from "@/lib/clientConfig";
import { placeOutboundCall, sendOutboundAttemptSms, type OutboundConfig } from "@/lib/outbound";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

function outboundConfig(): OutboundConfig {
  return {
    apiKey: process.env.VAPI_API_KEY || "",
    assistantId: process.env.VAPI_ASSISTANT_ID || "",
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || "",
  };
}

// Trigger an outbound Aria call to a lead. Body: { phone }. Secret-gated.
// The lead's consent + call-window pacing is enforced by the followup queue;
// this endpoint is the manual/triggered dial primitive.
export async function POST(request: NextRequest) {
  try {
    assertWebhookSecret(request);
    const payload = await parseWebhookPayload(request);
    const phone = String(payload.phone || payload.number || "");
    if (!phone) {
      return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
    }
    void clientConfig();
    const result = await placeOutboundCall(outboundConfig(), { customerNumber: phone });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    const sms = await sendOutboundAttemptSms(phone).catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send outbound attempt SMS",
    }));
    return NextResponse.json({ ok: true, call_id: result.id, sms });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to place outbound call.";
    const status = message.includes("secret") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
