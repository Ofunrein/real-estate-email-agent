import { NextRequest, NextResponse } from "next/server";

import { handleAriaToolCalls } from "@/lib/ariaWebhook";
import { assertWebhookSecret, parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

// Aria tool endpoint for Vapi-hosted property search/lookup tools plus local
// adapter tests and internal replay/runtime work. Returns Vapi's
// `{ results: [...] }` body when explicitly called.
export async function POST(request: NextRequest) {
  try {
    assertWebhookSecret(request);
    const payload = await parseWebhookPayload(request);
    const body = await handleAriaToolCalls(payload);
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Iris tool call.";
    const status = message.includes("secret") ? 401 : message.includes("DATABASE_URL") ? 503 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
