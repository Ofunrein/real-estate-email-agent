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
