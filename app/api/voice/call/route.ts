import { NextRequest, NextResponse } from "next/server";

import { clientConfig } from "@/lib/clientConfig";
import { placeOutboundCall, type OutboundConfig } from "@/lib/outbound";
import { blockLoadTestMutation } from "@/lib/loadTestGuard";
import { claimProviderAction, completeProviderAction } from "@/lib/providerSendSafety";

export const dynamic = "force-dynamic";

function outboundConfig(): OutboundConfig {
  return {
    apiKey: process.env.VAPI_API_KEY || "",
    assistantId: process.env.VAPI_ASSISTANT_ID || "",
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || "",
  };
}

// Dashboard-facing manual outbound dial. Session-protected by middleware (auth.ts),
// so no webhook secret needed. The agent calls the lead with full cross-channel
// memory via getCallerContext at call start. Body: { phone, leadName?, leadEmail?,
// callReason?, leadContext? }.
export async function POST(request: NextRequest) {
  const loadTestBlock = blockLoadTestMutation(request);
  if (loadTestBlock) return loadTestBlock;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const phone = String(body.phone || body.number || "");
    if (!phone) {
      return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
    }
    const config = clientConfig();
    const voiceCompanyName = config.voiceClientName || config.clientName;
    const callReason = String(body.callReason || body.reason || "your real estate request");
    const leadContext = String(body.leadContext || body.context || body.summary || "");

    const callInput = {
      customerNumber: phone,
      leadName: String(body.leadName || body.name || ""),
      leadEmail: String(body.leadEmail || body.email || ""),
      companyName: voiceCompanyName,
      agentName: config.agentNames.voice,
      callReason,
      leadContext,
      clientId: config.clientId,
      trigger: "manual",
    };
    const safety = await claimProviderAction({
      idempotencyKey: request.headers.get("x-idempotency-key") || request.headers.get("x-iris-idempotency-key") || "",
      action: "voice_call",
      channel: "voice",
      target: phone,
      threadRef: String(body.threadRef || ""),
      payload: callInput,
      maxPerMinute: Number(process.env.IRIS_VOICE_CALLS_PER_MINUTE || 4),
    });
    if (!safety.ok) {
      return NextResponse.json(
        safety.replay ? { ...(safety.result || {}), idempotentReplay: true } : { ok: false, error: safety.error },
        { status: safety.status },
      );
    }

    const result = await placeOutboundCall(outboundConfig(), callInput);
    const response = result.ok ? { ok: true, callId: result.id } : { ok: false, error: result.error };
    await completeProviderAction(safety.key, result.ok, response, result.ok ? "" : result.error || "Voice call failed");

    if (!result.ok) {
      return NextResponse.json(response, { status: 502 });
    }
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to place outbound call.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
