import { createHmac, randomUUID } from "node:crypto";

/**
 * Client for the lumenosis-site demo-management API.
 *
 * Decision B2: this app holds NO Turso credentials. It authenticates
 * server-to-server with an HMAC over the method, path, timestamp, nonce, and
 * exact body bytes, using LUMENOSIS_PLATFORM_API_SECRET.
 *
 * Decision B1: demo links are returned by the site verbatim and rendered as-is.
 * This client never derives, re-signs, or rotates a demo token, so every URL
 * already sent to a prospect keeps working.
 *
 * The remote API does not exist yet (it ships as a separate dependency PR).
 * Until both LUMENOSIS_PLATFORM_API_URL and LUMENOSIS_PLATFORM_API_SECRET are
 * configured, every call returns `not_configured` and the UI renders a disabled
 * state. It never invents demo data and never weakens the auth check.
 */

const SCHEME = "lumenosis-platform-v1";

export type DemoSummary = {
  id: string;
  fullName: string;
  businessName: string;
  emailDomain: string;
  address: string;
  status: string;
  outreachStatus: string;
  subject: string;
  demoUrl: string;
  createdAt: string;
};

export type DemoAdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_configured" | "unauthorized" | "unavailable"; detail?: string };

export type PlatformApiConfig = { baseUrl: string; secret: string };

/**
 * Resolve config from the environment. Returns null when either half is missing,
 * which is what drives the disabled UI state.
 */
export function platformApiConfig(env: NodeJS.ProcessEnv = process.env): PlatformApiConfig | null {
  const baseUrl = env.LUMENOSIS_PLATFORM_API_URL?.trim();
  const secret = env.LUMENOSIS_PLATFORM_API_SECRET?.trim();
  if (!baseUrl || !secret) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), secret };
}

export function platformApiConfigured(env: NodeJS.ProcessEnv = process.env) {
  return platformApiConfig(env) !== null;
}

/**
 * Build the signed headers for a request. Must match the site's
 * `signingPayload` byte-for-byte, including the body digest.
 */
export function signedHeaders(input: {
  secret: string;
  method: string;
  path: string;
  body: string;
  timestamp?: string;
  nonce?: string;
}) {
  const timestamp = input.timestamp ?? String(Date.now());
  const nonce = input.nonce ?? randomUUID();
  const bodyDigest = createHmac("sha256", SCHEME).update(input.body).digest("hex");
  const payload = [SCHEME, input.method.toUpperCase(), input.path, timestamp, nonce, bodyDigest].join("\n");
  const signature = createHmac("sha256", input.secret).update(payload).digest("hex");

  return {
    "content-type": "application/json",
    "x-lumenosis-timestamp": timestamp,
    "x-lumenosis-nonce": nonce,
    "x-lumenosis-signature": signature,
  } satisfies Record<string, string>;
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  bodyValue: unknown,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoAdminResult<T>> {
  const config = platformApiConfig(env);
  if (!config) return { ok: false, reason: "not_configured" };

  // Serialize once; the signature covers these exact bytes.
  const body = bodyValue === undefined ? "" : JSON.stringify(bodyValue);

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers: signedHeaders({ secret: config.secret, method, path, body }),
      body: method === "GET" ? undefined : body,
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "unavailable", detail: "Demo API unreachable" };
  }

  if (response.status === 401 || response.status === 403) return { ok: false, reason: "unauthorized" };
  if (response.status === 503) return { ok: false, reason: "not_configured" };
  if (!response.ok) return { ok: false, reason: "unavailable", detail: `Demo API returned ${response.status}` };

  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, reason: "unavailable", detail: "Demo API returned malformed JSON" };
  }
}

export async function listDemos(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoAdminResult<{ demos: DemoSummary[] }>> {
  return call<{ demos: DemoSummary[] }>("GET", "/api/platform/demos", undefined, env, fetchImpl);
}

export async function approveDemo(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoAdminResult<{ ok: boolean; approved: boolean }>> {
  return call("POST", `/api/platform/demos/${encodeURIComponent(id)}/approve`, {}, env, fetchImpl);
}

export async function sendDemoOutreach(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoAdminResult<{ ok: boolean; alreadySent: boolean }>> {
  return call("POST", `/api/platform/demos/${encodeURIComponent(id)}/send`, {}, env, fetchImpl);
}
