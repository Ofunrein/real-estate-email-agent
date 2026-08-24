import crypto from "node:crypto";

/**
 * Signed OAuth state for provider connect flows.
 *
 * The Meta and TikTok connect/callback pairs previously passed the tenant as
 * plain base64 JSON and trusted `state.clientId` on the way back. Neither
 * endpoint required a session, so anyone could start a connect flow naming
 * another tenant, finish OAuth with their own Page/account, and land a live
 * provider token under that tenant's client_id.
 *
 * This is the same construction `lib/gmailConnection.ts` already uses for
 * Gmail — HMAC-SHA256 over the payload, constant-time compare, short expiry —
 * lifted out so every provider shares one implementation instead of each
 * inventing its own.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export type ProviderOAuthState = {
  clientId: string;
  operatorEmail: string;
  channel?: string;
  next?: string;
};

type EncodedState = ProviderOAuthState & { nonce: string; iat: number };

function stateSecret(): string {
  return (
    process.env.EMAIL_ACCOUNT_OAUTH_STATE_SECRET
    || process.env.AUTH_SECRET
    || process.env.CHANNEL_WEBHOOK_SECRET
    || ""
  );
}

export function providerOAuthStateConfigured(): boolean {
  return Boolean(stateSecret());
}

export function signProviderOAuthState(input: ProviderOAuthState): string {
  const secret = stateSecret();
  if (!secret) throw new Error("AUTH_SECRET is required to sign provider OAuth state");
  if (!input.clientId || !input.operatorEmail) {
    throw new Error("Provider OAuth state requires clientId and operatorEmail");
  }
  const encoded: EncodedState = {
    ...input,
    nonce: crypto.randomBytes(16).toString("base64url"),
    iat: Date.now(),
  };
  const payload = Buffer.from(JSON.stringify(encoded), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Throws on any tampering, expiry, or missing field. Callers must not swallow it. */
export function verifyProviderOAuthState(value: string): ProviderOAuthState {
  const secret = stateSecret();
  if (!secret) throw new Error("AUTH_SECRET is required to verify provider OAuth state");

  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature) throw new Error("Invalid provider OAuth state");

  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Invalid provider OAuth state signature");
  }

  let decoded: Partial<EncodedState>;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<EncodedState>;
  } catch {
    throw new Error("Invalid provider OAuth state payload");
  }

  if (!decoded.iat || Date.now() - decoded.iat > STATE_TTL_MS) {
    throw new Error("Expired provider OAuth state");
  }
  if (!decoded.clientId || !decoded.operatorEmail) {
    throw new Error("Incomplete provider OAuth state");
  }

  return {
    clientId: decoded.clientId,
    operatorEmail: decoded.operatorEmail,
    channel: decoded.channel,
    next: decoded.next,
  };
}
