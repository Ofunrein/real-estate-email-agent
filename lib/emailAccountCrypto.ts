import crypto from "node:crypto";

const VERSION = "v1";

function encryptionSecret(): string {
  const secret = process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY
    || process.env.AUTH_SECRET
    || process.env.CHANNEL_WEBHOOK_SECRET
    || "";
  if (!secret) {
    throw new Error("EMAIL_ACCOUNT_ENCRYPTION_KEY or AUTH_SECRET is required for Gmail account storage");
  }
  return secret;
}

function encryptionKey(): Buffer {
  return crypto.createHash("sha256").update(encryptionSecret()).digest();
}

export function encryptEmailAccountToken(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptEmailAccountToken<T = Record<string, unknown>>(value: string): T {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (version !== VERSION || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Unsupported encrypted Gmail token format");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

/**
 * Provider access tokens (Meta Page, TikTok advertiser) at rest.
 *
 * These were stored in plaintext in channel_connections.page_access_token, so
 * any DB read yielded a usable credential. Encryption happens at the storage
 * boundary in lib/database.ts, which keeps every caller reading a plain token.
 *
 * Both directions are transparent to already-stored plaintext so this can ship
 * without a backfill: an unencrypted value decrypts to itself, and it is
 * re-encrypted on the next write.
 */
export function encryptProviderTokenAtRest(value: string): string {
  const token = String(value || "").trim();
  if (!token) return "";
  if (token.startsWith(`${VERSION}:`)) return token;
  try {
    return encryptEmailAccountToken(token);
  } catch {
    // No encryption secret configured. Storing plaintext preserves existing
    // behavior rather than silently dropping a connection's credential.
    return token;
  }
}

export function decryptProviderTokenAtRest(value: string): string {
  const token = String(value || "").trim();
  if (!token.startsWith(`${VERSION}:`)) return token;
  try {
    return decryptEmailAccountToken<string>(token);
  } catch {
    // A GCM auth-tag failure here means the encryption secret changed — most
    // likely because EMAIL_ACCOUNT_ENCRYPTION_KEY was added to a deployment
    // whose tokens were encrypted under AUTH_SECRET, which silently changes
    // which branch of the || chain wins. Returning "" quietly would show up
    // only as "no page access token" much later, so make it loud. The value
    // itself is never logged.
    console.error("provider_token_decrypt_failed", {
      reason: "encryption_key_mismatch_or_corrupt_ciphertext",
      hint: "Check EMAIL_ACCOUNT_ENCRYPTION_KEY / AUTH_SECRET; the connection must be reconnected if the key is gone.",
    });
    return "";
  }
}
