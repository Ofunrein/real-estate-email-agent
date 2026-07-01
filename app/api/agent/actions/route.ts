import { NextRequest, NextResponse } from "next/server";
import { executeAgentAction, type AgentActionInput } from "@/lib/agentActions";
import { createRequestAudit } from "@/lib/requestAudit";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/agent/actions",
    method: "POST",
    provider: "agent_action_api",
  });
  try {
    assertWebhookSecret(request);
    const payload = (await parseWebhookPayload(request)) as AgentActionInput;
    await audit.write("received", "received", {
      channel: payload.channel,
      threadRef: payload.threadRef,
      metadata: { action: payload.action, actorAgent: payload.actorAgent },
    });
    const result = await executeAgentAction(payload);
    await audit.write(result.ok ? "completed" : "blocked", result.ok ? "success" : "failed", {
      channel: payload.channel,
      contactRef: payload.to || payload.lead?.phone || payload.lead?.email,
      statusCode: result.ok ? 200 : result.blocked ? 409 : 502,
      errorCode: result.ok ? undefined : result.code,
      errorMessage: result.ok ? undefined : result.error,
      metadata: { action: payload.action, safeFallback: result.ok ? undefined : result.safeFallback },
    });
    return NextResponse.json(result, { status: result.ok ? 200 : result.blocked ? 409 : 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to execute agent action.";
    await audit.write("failed", "failed", {
      statusCode: message.includes("secret") ? 401 : 500,
      errorCode: message.includes("secret") ? "unauthorized" : "agent_action_failed",
      errorMessage: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: message.includes("secret") ? 401 : 500 });
  }
}
