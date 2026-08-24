import { NextRequest, NextResponse } from "next/server";

import { handleAgentSmsControl } from "@/lib/ariaSmsControl";
import { twilioSignedUrl, verifyTwilioWebhook } from "@/lib/twilioSignature";
import { assertTwilioInboundTenant, describeTenantMismatch } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const twiml = (status = 200) => new NextResponse("<Response></Response>", {
  status,
  headers: { "Content-Type": "text/xml; charset=utf-8" },
});

// Operator command channel: it can pause the agent and place outbound calls, so
// the sender must be proven to be Twilio before `From` is trusted.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  const verdict = verifyTwilioWebhook({
    url: twilioSignedUrl(request.url),
    params,
    signature: request.headers.get("x-twilio-signature") || "",
  });
  if (!verdict.ok) {
    const error = verdict.reason === "not_configured"
      ? "SMS control is not configured."
      : "Invalid Twilio signature.";
    return NextResponse.json({ ok: false, error }, { status: verdict.status });
  }

  const tenant = assertTwilioInboundTenant(params.To);
  if (!tenant.ok) {
    console.warn("aria_sms_control_tenant_mismatch", describeTenantMismatch(tenant));
    return NextResponse.json({ ok: false, error: "Unknown destination number." }, { status: 404 });
  }

  await handleAgentSmsControl(params.From || "", params.Body || "");
  return twiml();
}
