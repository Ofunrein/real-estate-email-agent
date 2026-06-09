import { NextRequest } from "next/server";

export async function parseWebhookPayload(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await request.json();
  }

  const text = await request.text();
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries());
}

export function assertWebhookSecret(request: NextRequest): void {
  const expected = process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!expected) return;
  const actual = request.headers.get("x-lumenosis-webhook-secret") || request.nextUrl.searchParams.get("secret") || "";
  if (actual !== expected) {
    throw new Error("Invalid webhook secret");
  }
}
