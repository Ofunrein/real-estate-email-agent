/**
 * Tenant identity for one deployment.
 *
 * Deployment model: one Vercel project + one Neon database per client. This
 * module is the single place that answers "which client is this deployment?"
 * and "does this provider callback belong to us?".
 *
 * Two separate concerns live here on purpose:
 *
 *   deploymentClientId()   — who we are. Read from CLIENT_ID.
 *   assert*Tenant()        — does this inbound provider payload belong to us?
 *
 * The second is the load-bearing one. Every webhook previously trusted "this
 * request reached my URL, therefore it is mine". Under one-project-per-client
 * that is true right up until a number is re-pointed, a Vapi assistant is
 * cloned, or a Gmail watch is registered against the wrong mailbox — and then
 * a webhook silently writes another client's conversation into this client's
 * database. These asserts derive tenancy from an identifier the provider
 * controls (the To number, the assistant id, the mailbox address) and compare
 * it against this deployment's configured value.
 *
 * Pure and env-injectable so the cross-tenant tests can drive it directly.
 */

import { requestWorkspaceId } from "@/lib/workspaceContext";

export const DEFAULT_CLIENT_ID = "default";

export type TenantEnv = Record<string, string | undefined>;

export type TenantMatch =
  | { ok: true; reason: "match" | "unconfigured" | "absent" }
  | { ok: false; reason: "mismatch"; expected: string; received: string };

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

/** Digits-only comparison so "+1 512 555 0100", "15125550100" and "tel:+15125550100" all match. */
export function normalizePhoneIdentity(value: unknown): string {
  const digits = clean(value).replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

export function normalizeEmailIdentity(value: unknown): string {
  return clean(value).toLowerCase();
}

/** The client this deployment serves. */
export function deploymentClientId(env: TenantEnv = process.env): string {
  return clean(env.CLIENT_ID) || DEFAULT_CLIENT_ID;
}

/**
 * The client the CURRENT unit of work belongs to.
 *
 * Prefers the AsyncLocalStorage workspace a dashboard session or a tenant-
 * carrying Inngest event established, and falls back to the deployment's own
 * id. Every module that scopes a query or a rate-limit bucket must use this
 * rather than reading process.env.CLIENT_ID, or a dashboard session and a
 * background job in the same process disagree about who they are serving.
 */
export function activeClientId(): string {
  return requestWorkspaceId() || deploymentClientId();
}

/**
 * Inngest app id. MUST be unique per deployment.
 *
 * Inngest Cloud keys apps by (environment, app id). Two deployments that
 * register the same app id into the same environment ARE the same app: the
 * later sync overwrites the earlier one's function→URL map, and one client's
 * events then execute against the other client's DATABASE_URL. Deriving the
 * id from CLIENT_ID makes that collision impossible by construction, and
 * INNGEST_APP_ID stays available as an explicit override.
 *
 * The historical single-tenant id is preserved for the original deployment so
 * upgrading it does not orphan its registered functions.
 */
export const LEGACY_INNGEST_APP_ID = "lumenosis-real-estate-agent";

export function inngestAppId(env: TenantEnv = process.env): string {
  const explicit = clean(env.INNGEST_APP_ID);
  if (explicit) return explicit;
  const clientId = deploymentClientId(env);
  if (clientId === DEFAULT_CLIENT_ID) return LEGACY_INNGEST_APP_ID;
  return `${LEGACY_INNGEST_APP_ID}-${clientId}`;
}

/**
 * Compare a provider-supplied identifier against this deployment's configured
 * value.
 *
 * `unconfigured` (we never set the expected value) and `absent` (the provider
 * did not send one) both pass: this is defense in depth layered on top of
 * signature verification, not a replacement for it, and failing closed on an
 * unset optional env var would break every existing deployment. A value that
 * is present on BOTH sides and disagrees is the real signal, and that fails.
 */
export function tenantIdentityMatches(
  expected: unknown,
  received: unknown,
  normalize: (value: unknown) => string = clean,
): TenantMatch {
  const want = normalize(expected);
  const got = normalize(received);
  if (!want) return { ok: true, reason: "unconfigured" };
  if (!got) return { ok: true, reason: "absent" };
  if (want === got) return { ok: true, reason: "match" };
  return { ok: false, reason: "mismatch", expected: want, received: got };
}

/**
 * Inbound Twilio message/call: the `To` number must be a number this
 * deployment owns.
 *
 * A Messaging Service can hold a sender pool, so TWILIO_INBOUND_NUMBERS
 * accepts a comma-separated allowlist. TWILIO_FROM is always included.
 */
export function twilioInboundNumbers(env: TenantEnv = process.env): string[] {
  return [clean(env.TWILIO_FROM), ...clean(env.TWILIO_INBOUND_NUMBERS).split(",")]
    .map(normalizePhoneIdentity)
    .filter(Boolean);
}

export function assertTwilioInboundTenant(to: unknown, env: TenantEnv = process.env): TenantMatch {
  const allowed = twilioInboundNumbers(env);
  if (!allowed.length) return { ok: true, reason: "unconfigured" };
  const received = normalizePhoneIdentity(to);
  if (!received) return { ok: true, reason: "absent" };
  if (allowed.includes(received)) return { ok: true, reason: "match" };
  return { ok: false, reason: "mismatch", expected: allowed.join(","), received };
}

/**
 * Inbound Vapi event: the assistant id and phone number id on the payload must
 * be the ones this deployment provisioned.
 */
export function assertVapiTenant(
  input: { assistantId?: unknown; phoneNumberId?: unknown },
  env: TenantEnv = process.env,
): TenantMatch {
  const assistant = tenantIdentityMatches(
    clean(env.VAPI_ASSISTANT_ID) || clean(env.ARIA_ASSISTANT_ID),
    input.assistantId,
  );
  if (!assistant.ok) return assistant;
  return tenantIdentityMatches(
    clean(env.VAPI_PHONE_NUMBER_ID) || clean(env.ARIA_PHONE_NUMBER_ID),
    input.phoneNumberId,
  );
}

/**
 * Gmail Pub/Sub push: the notified mailbox must be one this deployment
 * connected. The connected address comes from the database, so the caller
 * passes it in rather than this module reaching for a pool.
 */
export function assertGmailMailboxTenant(connectedEmail: unknown, pushedEmail: unknown): TenantMatch {
  return tenantIdentityMatches(connectedEmail, pushedEmail, normalizeEmailIdentity);
}

/** Log-safe rendering of a failed match — never widen this to include payload bodies. */
export function describeTenantMismatch(match: TenantMatch): string {
  if (match.ok) return "";
  return `expected=${match.expected} received=${match.received}`;
}
