import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "lumenosis_admin";

function signature() {
  const secret = process.env.DEMO_ROOM_SECRET;
  if (!secret) return "";
  return createHmac("sha256", secret).update("lumenosis-admin-v1").digest("base64url");
}

export function validAdminPassword(value: string) {
  const expected = process.env.LUMENOSIS_ADMIN_PASSWORD;
  if (!expected || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export async function isAdmin() {
  const supplied = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  const expected = signature();
  if (!supplied || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export function adminCookieValue() {
  return signature();
}
