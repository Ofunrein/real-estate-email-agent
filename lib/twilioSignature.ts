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
