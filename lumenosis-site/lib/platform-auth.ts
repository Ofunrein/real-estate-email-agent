import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-to-server authentication for the platform demo-administration API.
 *
 * The primary app (real-estate-email-agent, lib/demoAdminClient.ts) signs every
 * request with an HMAC over the scheme, method, path, timestamp, nonce, and a
 * digest of the exact body bytes, keyed on LUMENOSIS_PLATFORM_API_SECRET.
 *
 * This module is independent of lib/admin-auth.ts: the shared-password surface
 * stays untouched and neither path can authenticate the other. Nothing here is
 * ever logged — no bodies, tokens, signatures, secrets, or prospect data.
 */

export const PLATFORM_SCHEME = "lumenosis-platform-v1";

export const TIMESTAMP_HEADER = "x-lumenosis-timestamp";
export const NONCE_HEADER = "x-lumenosis-nonce";
export const SIGNATURE_HEADER = "x-lumenosis-signature";

/** Bounded clock skew, in milliseconds. Timestamps are unix milliseconds. */
export const MAX_SKEW_MS = 300_000;

export type PlatformAuthFailure =
  | "not_configured"
  | "bad_method"
  | "bad_content_type"
  | "missing_headers"
  | "bad_timestamp"
  | "skew"
  | "bad_nonce"
  | "replay"
  | "bad_signature";

export type PlatformAuthResult = { ok: true } | { ok: false; reason: PlatformAuthFailure };

export function platformSecret(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.LUMENOSIS_PLATFORM_API_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  return secret;
}

export function platformApiConfigured(env: NodeJS.ProcessEnv = process.env) {
  return platformSecret(env) !== null;
}

/** Must stay byte-identical to the primary app's signedHeaders payload. */
export function signingPayload(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}) {
  const bodyDigest = createHmac("sha256", PLATFORM_SCHEME).update(input.body).digest("hex");
  return [
    PLATFORM_SCHEME,
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    bodyDigest,
  ].join("\n");
}

export function expectedSignature(secret: string, input: Parameters<typeof signingPayload>[0]) {
  return createHmac("sha256", secret).update(signingPayload(input)).digest("hex");
}

function constantTimeEquals(supplied: string, expected: string) {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Best-effort replay protection. A serverless instance cannot see nonces used by
 * a sibling instance, so this narrows the replay window rather than closing it;
 * the bounded skew window is the hard limit. Entries expire with the window so
 * the map cannot grow without bound.
 */
const seenNonces = new Map<string, number>();

export function rememberNonce(
  nonce: string,
  now = Date.now(),
  store: Map<string, number> = seenNonces,
) {
  for (const [key, expiry] of store) if (expiry <= now) store.delete(key);
  if (store.has(nonce)) return false;
  store.set(nonce, now + MAX_SKEW_MS);
  return true;
}

export function verifyPlatformRequest(input: {
  method: string;
  path: string;
  body: string;
  headers: Headers;
  env?: NodeJS.ProcessEnv;
  now?: number;
  nonceStore?: Map<string, number>;
  allowedMethods?: string[];
}): PlatformAuthResult {
  const method = input.method.toUpperCase();
  const allowed = input.allowedMethods ?? ["GET", "POST"];
  if (!allowed.includes(method)) return { ok: false, reason: "bad_method" };

  const secret = platformSecret(input.env ?? process.env);
  if (!secret) return { ok: false, reason: "not_configured" };

  if (method !== "GET") {
    const contentType = input.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return { ok: false, reason: "bad_content_type" };
  }

  const timestamp = input.headers.get(TIMESTAMP_HEADER)?.trim() ?? "";
  const nonce = input.headers.get(NONCE_HEADER)?.trim() ?? "";
  const signature = input.headers.get(SIGNATURE_HEADER)?.trim() ?? "";
  if (!timestamp || !nonce || !signature) return { ok: false, reason: "missing_headers" };

  if (!/^\d{10,16}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const now = input.now ?? Date.now();
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return { ok: false, reason: "skew" };

  if (!/^[A-Za-z0-9-]{16,128}$/.test(nonce)) return { ok: false, reason: "bad_nonce" };
  if (!/^[a-f0-9]{64}$/.test(signature)) return { ok: false, reason: "bad_signature" };

  const expected = expectedSignature(secret, {
    method,
    path: input.path,
    timestamp,
    nonce,
    body: input.body,
  });
  if (!constantTimeEquals(signature, expected)) return { ok: false, reason: "bad_signature" };

  if (!rememberNonce(nonce, now, input.nonceStore ?? seenNonces))
    return { ok: false, reason: "replay" };

  return { ok: true };
}
