import { NextRequest, NextResponse } from "next/server";

import { handleAgentSmsControl } from "@/lib/ariaSmsControl";
import { twilioSignatureEnforced, twilioSignatureValid, twilioSignedUrl } from "@/lib/twilioSignature";

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

  if (!twilioSignatureEnforced()) {
    return NextResponse.json({ ok: false, error: "SMS control is not configured." }, { status: 503 });
  }

  const valid = twilioSignatureValid({
    url: twilioSignedUrl(request.url),
    params,
    signature: request.headers.get("x-twilio-signature") || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
  });
  if (!valid) {
    return NextResponse.json({ ok: false, error: "Invalid Twilio signature." }, { status: 403 });
  }

  await handleAgentSmsControl(params.From || "", params.Body || "");
  return twiml();
}
