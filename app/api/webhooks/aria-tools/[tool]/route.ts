import { NextRequest, NextResponse } from "next/server";

import { handleAriaToolCalls } from "@/lib/ariaWebhook";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

// Per-tool server endpoint for Aria's Vapi function calls. The assistant points
// each server tool at /api/webhooks/aria-tools/<name>; the [tool] segment is
// informational — the tool name comes from the Vapi payload itself, which
// handleAriaToolCalls dispatches. Returns Vapi's `{ results: [...] }` body.
export async function POST(request: NextRequest) {
  try {
    assertWebhookSecret(request);
    const payload = await parseWebhookPayload(request);
    const body = await handleAriaToolCalls(payload);
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Aria tool call.";
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
