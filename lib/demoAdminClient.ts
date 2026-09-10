import { createHmac, randomUUID } from "node:crypto";

import {
  type DemoSummary,
  demoClientId,
  demoOwnershipEnabled,
  listDemos as listDemosFromPostgres,
} from "@/lib/demoOwnershipStore";

/**
 * Demo administration data source, across the ownership cutover.
 *
 * BEFORE cutover (DEMO_DATA_OWNER unset): reads and mutations both travel to
 * lumenosis-site over the signed platform API, which is what PR #7 originally shipped.
 *
 * AFTER cutover (DEMO_DATA_OWNER=postgres): this app owns the data. Reads go straight to
 * its own Neon database with no outbound request at all, and the signed client is no
 * longer used for them. That is the app-to-app hop this architecture removes.
 *
 * Mutations (approve, send) are owned by this app after cutover too — they run against
 * Postgres and this app performs the send. The signed API remains only as the
 * pre-cutover path, so a mixed-version deploy has exactly one writer at any instant:
 * whichever side the flag names.
 *
 * Decision B1 is unchanged in both directions: demo links are rendered verbatim. No token
 * is derived, re-signed, or rotated, so every URL already sent to a prospect keeps working.
 */

const SCHEME = "lumenosis-platform-v1";

export type { DemoSummary };

export type DemoAdminResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: "not_configured" | "unauthorized" | "unavailable";
      detail?: string;
    };

export type PlatformApiConfig = { baseUrl: string; secret: string };

/**
 * Resolve config from the environment. Returns null when either half is missing,
 * which is what drives the disabled UI state.
 */
export function platformApiConfig(env: Record<string, string | undefined> = process.env): PlatformApiConfig | null {
  const baseUrl = env.LUMENOSIS_PLATFORM_API_URL?.trim();
  const secret = env.LUMENOSIS_PLATFORM_API_SECRET?.trim();
  if (!baseUrl || !secret) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), secret };
}

export function platformApiConfigured(env: Record<string, string | undefined> = process.env) {
  return platformApiConfig(env) !== null;
}

/**
 * Which side owns demo data right now. Exposed so the UI can name the active source in
 * its not-configured copy instead of guessing.
 */
export function demoDataSource(env: Record<string, string | undefined> = process.env): "postgres" | "platform-api" {
  return demoOwnershipEnabled(env) ? "postgres" : "platform-api";
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
  env: Record<string, string | undefined> = process.env,
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

/**
 * After cutover this is a local database read: no outbound request, no signed hop. A
 * database failure surfaces as `unavailable` with a fixed string — the driver's message
 * can embed a connection string, so it is never propagated to the UI.
 */
export async function listDemos(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoAdminResult<{ demos: DemoSummary[] }>> {
  if (demoOwnershipEnabled(env)) {
    if (!env.DATABASE_URL) return { ok: false, reason: "not_configured" };
    try {
      return { ok: true, data: { demos: await listDemosFromPostgres(demoClientId(env)) } };
    } catch {
      return { ok: false, reason: "unavailable", detail: "Demo database read failed" };
    }
  }
  return call<{ demos: DemoSummary[] }>("GET", "/api/platform/demos", undefined, env, fetchImpl);
}

export async function approveDemo(
  id: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoAdminResult<{ ok: boolean; approved: boolean }>> {
  if (demoOwnershipEnabled(env)) {
    if (!env.DATABASE_URL) return { ok: false, reason: "not_configured" };
    const { approveDemo: approveInPostgres } = await import("@/lib/demoOwnershipStore");
    try {
      const result = await approveInPostgres(id, demoClientId(env));
      if (!result.ok) return { ok: false, reason: "unavailable", detail: "Demo room not found" };
      return { ok: true, data: { ok: true, approved: result.approved } };
    } catch {
      return { ok: false, reason: "unavailable", detail: "Demo approve failed" };
    }
  }
  return call("POST", `/api/platform/demos/${encodeURIComponent(id)}/approve`, {}, env, fetchImpl);
}

export async function sendDemoOutreach(
  id: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoAdminResult<{ ok: boolean; alreadySent: boolean }>> {
  if (demoOwnershipEnabled(env)) {
    if (!env.DATABASE_URL) return { ok: false, reason: "not_configured" };
    const { sendDemoOutreach: sendFromPostgres } = await import("@/lib/demoOwnershipStore");
    try {
      const result = await sendFromPostgres(id, demoClientId(env));
      if (!result.ok) {
        // not_configured is surfaced as itself so the UI tells the operator to set the
        // provider key rather than reporting a generic outage.
        if (result.reason === "not_configured") return { ok: false, reason: "not_configured" };
        return {
          ok: false,
          reason: "unavailable",
          detail:
            result.reason === "not_found"
              ? "No approved draft to send"
              : result.reason === "delivery_uncertain"
                ? "Email delivery is uncertain; the claim is retained to prevent a duplicate send"
                : "Email provider rejected the send; the draft is still sendable",
        };
      }
      return { ok: true, data: { ok: true, alreadySent: result.alreadySent } };
    } catch {
      return { ok: false, reason: "unavailable", detail: "Demo send failed" };
    }
  }
  return call("POST", `/api/platform/demos/${encodeURIComponent(id)}/send`, {}, env, fetchImpl);
}
