import { timingSafeEqual } from "node:crypto";

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

export function constantTimeSecretEqual(actual: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Rejects any channel webhook that does not present the shared secret.
 *
 * Fails CLOSED: when CHANNEL_WEBHOOK_SECRET is missing in production the
 * endpoint refuses traffic instead of accepting anonymous provider callbacks.
 */
export function assertWebhookSecret(request: NextRequest): void {
  const expected = process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CHANNEL_WEBHOOK_SECRET is not configured");
    }
    return;
  }
  // Query-string secrets stay supported for providers already configured that
  // way, but they leak into access logs — prefer the header.
  const actual = request.headers.get("x-lumenosis-webhook-secret") || request.nextUrl.searchParams.get("secret") || "";
  if (!constantTimeSecretEqual(actual, expected)) {
    throw new Error("Invalid webhook secret");
  }
}
