import { NextRequest, NextResponse } from "next/server";

import { clientId, databaseEnabled, readDefaultEmailAccountFromDatabase } from "@/lib/database";
import { readRequestAuditEvents, summarizeRequestAuditCosts } from "@/lib/requestAudit";
import { usageSnapshot } from "@/lib/usageCaps";
import { deploymentClientId, inngestAppId, twilioInboundNumbers } from "@/lib/tenant";
import { constantTimeSecretEqual } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Per-client health, for the runbooks in docs/runbooks/.
 *
 * One endpoint per deployment answering "is this client's agent working, and
 * what is it costing?". Reports posture (what is configured) and recent
 * outcomes (what actually happened) — never a credential value, because the
 * whole point is that an operator can page this during an incident and paste
 * the output somewhere.
 *
 * Auth: CRON_SECRET or CHANNEL_WEBHOOK_SECRET, same convention as the cron
 * routes. Fails closed when neither is set.
 */

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const query = request.nextUrl.searchParams.get("secret") || "";
  return constantTimeSecretEqual(header, `Bearer ${secret}`) || constantTimeSecretEqual(query, secret);
}

function configured(value: string | undefined): boolean {
  return Boolean(String(value || "").trim());
}

/** What this deployment is wired for. Booleans and counts only. */
function posture() {
  return {
    client_id: deploymentClientId(),
    inngest_app_id: inngestAppId(),
    database: databaseEnabled(),
    public_base_url_set: configured(process.env.PUBLIC_BASE_URL),
    channels: {
      email: {
        live: process.env.IRIS_EMAIL_LIVE === "true",
        sends_replies: process.env.IRIS_EMAIL_SEND_REPLIES === "true",
        gmail_push_token_set: configured(process.env.GMAIL_PUBSUB_TOKEN),
      },
      sms: {
        enabled: String(process.env.ENABLE_SMS_AGENT || "").toLowerCase() === "true",
        signature_enforced: configured(process.env.TWILIO_AUTH_TOKEN),
        messaging_service: configured(process.env.TWILIO_MESSAGING_SERVICE_SID),
        inbound_numbers: twilioInboundNumbers().length,
      },
      voice: {
        assistant_set: configured(process.env.VAPI_ASSISTANT_ID),
        number_set: configured(process.env.VAPI_PHONE_NUMBER_ID),
        transfer_number_set: configured(process.env.HUMAN_TRANSFER_NUMBER),
      },
    },
    secrets_present: {
      // Presence only. Absence is the actionable signal during an incident.
      auth_secret: configured(process.env.AUTH_SECRET),
      channel_webhook_secret: configured(process.env.CHANNEL_WEBHOOK_SECRET),
      cron_secret: configured(process.env.CRON_SECRET),
      inngest_signing_key: configured(process.env.INNGEST_SIGNING_KEY),
    },
  };
}

/** OAuth expiry is the most common silent failure — surface it before it bites. */
async function emailAccountHealth() {
  if (!databaseEnabled()) return { connected: false, reason: "database_disabled" };
  const account = await readDefaultEmailAccountFromDatabase().catch(() => null);
  if (!account) return { connected: false, reason: "no_connected_mailbox" };

  const watchExpiration = Number(account.gmail_watch_expiration || 0);
  const hoursToWatchExpiry = watchExpiration ? Math.round((watchExpiration - Date.now()) / 3_600_000) : null;
  return {
    connected: account.status === "connected",
    status: account.status || "",
    // The mailbox address is operator-facing config, not a lead's PII.
    mailbox: account.email || "",
    last_error: String(account.last_error || "").slice(0, 200),
    gmail_watch_hours_remaining: hoursToWatchExpiry,
    // Watches last 7 days and Inngest renews daily; under ~24h means renewal
    // is failing and inbound email is about to stop arriving.
    gmail_watch_healthy: hoursToWatchExpiry == null ? false : hoursToWatchExpiry > 24,
  };
}

async function recentFailures() {
  if (!databaseEnabled()) return { window: "24h", total: 0, byCode: {} as Record<string, number> };
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const events = await readRequestAuditEvents({ errorsOnly: true, since, limit: 500 }).catch(() => []);
  const byCode: Record<string, number> = {};
  for (const event of events) {
    const code = event.errorCode || event.outcome || "unknown";
    byCode[code] = (byCode[code] || 0) + 1;
  }
  return { window: "24h", total: events.length, byCode };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [email, failures, usage, costEvents] = await Promise.all([
    emailAccountHealth().catch(() => ({ connected: false, reason: "health_check_failed" })),
    recentFailures(),
    usageSnapshot(clientId()).catch(() => null),
    databaseEnabled()
      ? readRequestAuditEvents({ since, limit: 1000 }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const costs = summarizeRequestAuditCosts(costEvents);

  const overCap = (usage?.usage || []).filter((entry: { limit: number; used: number }) => entry.limit > 0 && entry.used >= entry.limit);
  const degraded = overCap.length > 0
    || (email as { gmail_watch_healthy?: boolean }).gmail_watch_healthy === false
    || failures.total > Number(process.env.HEALTH_FAILURE_ALERT_THRESHOLD || 25);

  return NextResponse.json({
    ok: true,
    status: degraded ? "degraded" : "healthy",
    checked_at: new Date().toISOString(),
    posture: posture(),
    email,
    failures,
    usage,
    cost_24h: costs,
    over_cap: overCap.map((entry: { kind: string }) => entry.kind),
  }, { headers: { "Cache-Control": "no-store" } });
}
