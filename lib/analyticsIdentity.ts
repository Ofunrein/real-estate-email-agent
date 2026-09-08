import "server-only";
import { createHmac } from "node:crypto";

export function opaqueAnalyticsId(value: string): string {
  const secret = process.env.AUTH_SECRET;
  const normalized = value.trim().toLowerCase();
  if (!secret || !normalized) return "";
  return createHmac("sha256", secret).update(normalized).digest("base64url");
}
