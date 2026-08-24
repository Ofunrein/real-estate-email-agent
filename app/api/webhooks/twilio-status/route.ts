import { NextRequest, NextResponse } from "next/server";

import { upsertLeadMemoryToDatabase } from "@/lib/database";
import { normalizeTwilioContactAddress } from "@/lib/channelIngest";
import { optOutPatch } from "@/lib/contactSuppression";
import { createRequestAudit } from "@/lib/requestAudit";
import { assertTwilioInboundTenant, describeTenantMismatch } from "@/lib/tenant";
import { twilioSignedUrl, verifyTwilioWebhook } from "@/lib/twilioSignature";

export const dynamic = "force-dynamic";

/**
 * Twilio delivery status callback.
 *
 * Without this, a send is marked "sent" the instant Twilio returns a SID, and
 * every carrier-side outcome is invisible: 30003 unreachable, 30006 landline,
 * 30007 carrier spam filtering, 30032 unregistered A2P traffic, and 21610 —
 * Twilio's own record that the recipient has opted out.
 *
 * 21610 is treated as an authoritative opt-out. Twilio knows about STOPs sent
 * to the Messaging Service that never reach our inbound webhook, so this is
 * the only way to learn about them.
 */

// Carrier/Twilio error codes that mean "this recipient must not be messaged again".
const OPT_OUT_ERROR_CODES = new Set(["21610", "21211"]);

function formParams(text: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(text).entries());
}

export async function POST(request: NextRequest) {
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/webhooks/twilio-status",
    method: "POST",
    channel: "sms",
    provider: "twilio",
  });

  const params = formParams(await request.text());

  const signature = verifyTwilioWebhook({
    url: twilioSignedUrl(request.url),
    params,
    signature: request.headers.get("x-twilio-signature") || "",
  });
  if (!signature.ok) {
    await audit.write("auth", "blocked", { statusCode: signature.status, errorCode: signature.reason });
    return NextResponse.json({ ok: false, error: "Twilio signature verification failed." }, { status: signature.status });
  }

  // Status callbacks name our own number in From (the message we sent).
  const tenant = assertTwilioInboundTenant(params.From);
  if (!tenant.ok) {
    console.warn("twilio_status_tenant_mismatch", describeTenantMismatch(tenant));
    await audit.write("auth", "blocked", { statusCode: 404, errorCode: "twilio_tenant_mismatch" });
    return NextResponse.json({ ok: false, error: "Unknown sender number." }, { status: 404 });
  }

  const messageStatus = (params.MessageStatus || params.SmsStatus || "").trim().toLowerCase();
  const errorCode = (params.ErrorCode || "").trim();
  const recipient = normalizeTwilioContactAddress(params.To || "");
  const failed = messageStatus === "failed" || messageStatus === "undelivered" || Boolean(errorCode);

  if (OPT_OUT_ERROR_CODES.has(errorCode) && recipient) {
    // Twilio blocked the send because the recipient opted out. Record it so our
    // own suppression matches the carrier's, and no further attempt is made.
    await upsertLeadMemoryToDatabase({ phone: recipient, ...optOutPatch("sms") });
  }

  await audit.write("delivery", failed ? "failed" : "sent", {
    contactRef: recipient,
    providerMessageId: params.MessageSid || "",
    errorCode,
    errorMessage: (params.ErrorMessage || "").slice(0, 300),
    metadata: {
      messageStatus,
      channel: (params.MessagingServiceSid || "").startsWith("MG") ? "messaging_service" : "direct_number",
      optOutRecorded: OPT_OUT_ERROR_CODES.has(errorCode),
    },
  });

  // Always 200 — a non-2xx makes Twilio retry a status callback we have
  // already recorded.
  return NextResponse.json({ ok: true });
}
