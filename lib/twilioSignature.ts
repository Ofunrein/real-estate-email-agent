import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio request signature validation (X-Twilio-Signature).
 *
 * Twilio signs `url + sorted(param key + value)` with the account auth token.
 * Without this check any caller can forge a webhook body — including the `From`
 * number that operator-command handlers trust.
 */
export function twilioSignatureValid(input: {
  url: string;
  params: Record<string, string>;
  signature: string;
  authToken: string;
}): boolean {
  const { url, params, signature, authToken } = input;
  if (!signature || !authToken) return false;

  const payload = Object.keys(params)
    .sort()
    .reduce((accumulator, key) => accumulator + key + params[key], url);

  const expected = createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
  const provided = Buffer.from(signature, "utf8");
  const computed = Buffer.from(expected, "utf8");
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(provided, computed);
}

/**
 * The URL Twilio signed. Twilio signs the URL it was configured with, which is
 * the public origin — not the internal request URL a proxy may rewrite.
 */
export function twilioSignedUrl(requestUrl: string): string {
  const publicBase = (process.env.TWILIO_WEBHOOK_BASE_URL || process.env.PUBLIC_BASE_URL || "").trim();
  if (!publicBase) return requestUrl;
  try {
    const incoming = new URL(requestUrl);
    const base = new URL(publicBase);
    return new URL(`${incoming.pathname}${incoming.search}`, base.origin).toString();
  } catch {
    return requestUrl;
  }
}

export function twilioSignatureEnforced(): boolean {
  return Boolean(process.env.TWILIO_AUTH_TOKEN);
}

export type TwilioWebhookVerdict =
  | { ok: true; reason: "verified" | "unenforced_outside_production" }
  | { ok: false; status: 403 | 503; reason: "not_configured" | "invalid_signature" };

/**
 * The single gate every Twilio-facing route runs before trusting a payload.
 *
 * Fails CLOSED in production: without TWILIO_AUTH_TOKEN the signature cannot
 * be checked, so `From` is unauthenticated and the route must refuse rather
 * than quietly accept forged inbound messages. Outside production an unset
 * token is allowed so local replay harnesses still work.
 *
 * The token is this deployment's own, which is what ties the check to this
 * tenant: a signature minted by another client's Twilio account will not
 * validate here.
 */
export function verifyTwilioWebhook(input: {
  url: string;
  params: Record<string, string>;
  signature: string;
  authToken?: string;
  nodeEnv?: string;
}): TwilioWebhookVerdict {
  const authToken = (input.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  if (!authToken) {
    const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV;
    if (nodeEnv === "production") return { ok: false, status: 503, reason: "not_configured" };
    return { ok: true, reason: "unenforced_outside_production" };
  }

  const valid = twilioSignatureValid({
    url: input.url,
    params: input.params,
    signature: input.signature,
    authToken,
  });
  return valid ? { ok: true, reason: "verified" } : { ok: false, status: 403, reason: "invalid_signature" };
}
