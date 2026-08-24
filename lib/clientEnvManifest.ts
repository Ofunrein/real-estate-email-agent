/**
 * The environment contract for one client deployment.
 *
 * Deployment model: one Vercel project + one Neon database per client. This
 * manifest is what makes that model checkable — it names every variable that
 * MUST differ between clients, so provisioning can refuse to stand up a
 * deployment that would quietly share a number, an assistant, or a database
 * with an existing one.
 *
 * `scope` is the load-bearing field:
 *   tenant   — identity. Two clients sharing one of these ARE one client.
 *   isolated — a provider credential or resource that must not be shared.
 *   shared   — safe to reuse across clients (read-only public data APIs,
 *              model names, tuning knobs).
 *
 * Values never appear here. Only names, scope, and why.
 */

export type EnvScope = "tenant" | "isolated" | "shared";

export type EnvRequirement = {
  name: string;
  scope: EnvScope;
  /** Deployment cannot serve traffic without it. */
  required: boolean;
  /** Only required when the matching channel is switched on. */
  channel?: "email" | "sms" | "voice" | "whatsapp" | "social" | "calendar" | "crm";
  why: string;
};

export const CLIENT_ENV_MANIFEST: readonly EnvRequirement[] = [
  // ---- identity -----------------------------------------------------------
  { name: "CLIENT_ID", scope: "tenant", required: true, why: "Row-level tenant key on every table. Two deployments sharing it share all data." },
  { name: "CLIENT_NAME", scope: "tenant", required: true, why: "Brand name the agents speak and sign." },
  { name: "PUBLIC_BASE_URL", scope: "tenant", required: true, why: "Every provider webhook and OAuth redirect is registered against it." },
  { name: "WORKSPACE_EMAIL_MAP", scope: "tenant", required: true, why: "Maps the operator's login to this tenant. Unset falls back to a hardcoded personal address that would own the dashboard." },
  { name: "AUTH_ALLOWED_EMAILS", scope: "tenant", required: true, why: "Who may sign in to this client's dashboard." },
  { name: "INNGEST_APP_ID", scope: "tenant", required: false, why: "Derived from CLIENT_ID when unset. Two deployments sharing an app id become one Inngest app and cross-wire events." },

  // ---- infrastructure -----------------------------------------------------
  { name: "DATABASE_URL", scope: "isolated", required: true, why: "One Neon database per client. Sharing it defeats the whole isolation model." },
  { name: "AUTH_SECRET", scope: "isolated", required: true, why: "Signs sessions and provider OAuth state, and derives the token-encryption key." },
  { name: "CHANNEL_WEBHOOK_SECRET", scope: "isolated", required: true, why: "Shared secret on channel webhooks. Reuse means one leak opens every client." },
  { name: "CRON_SECRET", scope: "isolated", required: true, why: "Authorizes scheduled endpoints." },
  { name: "INNGEST_SIGNING_KEY", scope: "isolated", required: true, why: "Inngest refuses to serve in production without it; per-environment." },
  { name: "INNGEST_EVENT_KEY", scope: "isolated", required: true, why: "Publishes events into this client's Inngest environment." },
  { name: "ANTHROPIC_API_KEY", scope: "isolated", required: true, why: "Per-client key keeps AI spend attributable and capped." },
  { name: "EMAIL_ACCOUNT_ENCRYPTION_KEY", scope: "isolated", required: false, why: "Encrypts stored provider tokens. Falls back to AUTH_SECRET." },
  { name: "EMAIL_ACCOUNT_OAUTH_STATE_SECRET", scope: "isolated", required: false, why: "Signs provider OAuth state. Falls back to AUTH_SECRET." },

  // ---- email (Iris) -------------------------------------------------------
  { name: "GMAIL_OAUTH_CLIENT_ID", scope: "isolated", required: false, channel: "email", why: "OAuth client for this client's mailbox connection." },
  { name: "GMAIL_OAUTH_CLIENT_SECRET", scope: "isolated", required: false, channel: "email", why: "Pairs with GMAIL_OAUTH_CLIENT_ID." },
  { name: "GMAIL_PUBSUB_TOKEN", scope: "isolated", required: false, channel: "email", why: "Authenticates the Gmail push endpoint. Per-deployment." },
  { name: "GMAIL_PUBSUB_TOPIC", scope: "isolated", required: false, channel: "email", why: "Pub/Sub topic carrying this mailbox's notifications." },
  { name: "GOOGLE_CLOUD_PROJECT_ID", scope: "isolated", required: false, channel: "email", why: "Project owning the Pub/Sub topic and OAuth client." },
  { name: "IRIS_EMAIL_LIVE", scope: "shared", required: false, channel: "email", why: "Master switch. Unset means Iris processes but never sends." },
  { name: "IRIS_EMAIL_SEND_REPLIES", scope: "shared", required: false, channel: "email", why: "Second gate; both must be true before a reply leaves." },

  // ---- SMS / WhatsApp (Theo) ---------------------------------------------
  { name: "TWILIO_ACCOUNT_SID", scope: "isolated", required: false, channel: "sms", why: "One Twilio subaccount per client keeps numbers, spend, and A2P registration separate." },
  { name: "TWILIO_AUTH_TOKEN", scope: "isolated", required: false, channel: "sms", why: "Also what verifies inbound webhook signatures — sharing it lets one client's signature validate at another." },
  { name: "TWILIO_FROM", scope: "isolated", required: false, channel: "sms", why: "This client's dedicated number. Also the inbound tenant check." },
  { name: "TWILIO_MESSAGING_SERVICE_SID", scope: "isolated", required: false, channel: "sms", why: "A2P 10DLC campaign registration attaches to the service, not the number." },
  { name: "TWILIO_INBOUND_NUMBERS", scope: "isolated", required: false, channel: "sms", why: "Extra numbers in this client's sender pool, accepted by the inbound tenant check." },
  { name: "ENABLE_SMS_AGENT", scope: "shared", required: false, channel: "sms", why: "Send switch for the SMS channel." },
  { name: "WHATSAPP_ACCESS_TOKEN", scope: "isolated", required: false, channel: "whatsapp", why: "This client's WhatsApp Business account." },
  { name: "WHATSAPP_WEBHOOK_VERIFY_TOKEN", scope: "isolated", required: false, channel: "whatsapp", why: "Meta webhook handshake for this deployment." },

  // ---- voice (Aria) -------------------------------------------------------
  { name: "VAPI_API_KEY", scope: "isolated", required: false, channel: "voice", why: "One Vapi account per client; tools upsert org-wide by name." },
  { name: "VAPI_ASSISTANT_ID", scope: "isolated", required: false, channel: "voice", why: "This client's assistant. Also the inbound call tenant check." },
  { name: "VAPI_PHONE_NUMBER_ID", scope: "isolated", required: false, channel: "voice", why: "This client's voice number binding." },
  { name: "HUMAN_TRANSFER_NUMBER", scope: "isolated", required: false, channel: "voice", why: "Live transfer destination. A wrong value routes callers to another business." },
  { name: "ARIA_AGENT_CONFIRMATION_PHONE", scope: "isolated", required: false, channel: "voice", why: "Booking alerts. Unset skips the alert rather than defaulting to someone else's phone." },
  { name: "ARIA_RECORDING_DISCLOSURE", scope: "shared", required: false, channel: "voice", why: "Override the recorded-call disclosure wording; 'off' only when recording is disabled in Vapi." },

  // ---- calendar / CRM -----------------------------------------------------
  { name: "CALENDAR_PROVIDER", scope: "shared", required: false, channel: "calendar", why: "google | outlook | ghl | neon." },
  { name: "GOOGLE_REFRESH_TOKEN", scope: "isolated", required: false, channel: "calendar", why: "This client's calendar account." },
  { name: "GOOGLE_CALENDAR_ID", scope: "isolated", required: false, channel: "calendar", why: "Calendar bookings land on." },
  { name: "CRM_PROVIDER", scope: "shared", required: false, channel: "crm", why: "ghl | fub | kvcore | none." },
  { name: "GHL_PRIVATE_INTEGRATION_TOKEN", scope: "isolated", required: false, channel: "crm", why: "This client's GHL location." },
  { name: "GHL_LOCATION_ID", scope: "isolated", required: false, channel: "crm", why: "Sub-account receiving synced contacts." },

  // ---- shared-safe --------------------------------------------------------
  { name: "FRED_API_KEY", scope: "shared", required: false, why: "Read-only public economic data." },
  { name: "CENSUS_API_KEY", scope: "shared", required: false, why: "Read-only public demographic data." },
  { name: "APIFY_TOKEN", scope: "shared", required: false, why: "Property import scraper; usage is metered, not tenant-bearing." },
] as const;

export type EnvCheck = {
  ok: boolean;
  missingRequired: string[];
  /** Variables set to the same value as another client's deployment. */
  collisions: Array<{ name: string; scope: EnvScope; otherClientId: string }>;
  /** Set but not part of the manifest — informational, never fatal. */
  unrecognized: string[];
};

const MANIFEST_BY_NAME = new Map(CLIENT_ENV_MANIFEST.map((entry) => [entry.name, entry]));

/** Required names for a deployment with these channels switched on. */
export function requiredEnvNames(channels: readonly string[] = []): string[] {
  const enabled = new Set(channels);
  return CLIENT_ENV_MANIFEST
    .filter((entry) => entry.required || (entry.channel != null && enabled.has(entry.channel)))
    .map((entry) => entry.name);
}

/**
 * Validate one client's env against the manifest, and against every other
 * client already provisioned.
 *
 * The collision check is the point. A missing variable fails loudly at boot;
 * a variable accidentally copied from another client's file fails silently, in
 * production, by writing one client's leads into another's database.
 */
export function checkClientEnv(input: {
  clientId: string;
  env: Record<string, string | undefined>;
  /** Channels this client is turning on; their vars become required too. */
  channels?: readonly string[];
  /** clientId → env, for every other already-provisioned client. */
  otherClients?: Record<string, Record<string, string | undefined>>;
}): EnvCheck {
  const value = (name: string) => String(input.env[name] ?? "").trim();
  const required = new Set(requiredEnvNames(input.channels || []));

  const missingRequired = [...required].filter((name) => !value(name)).sort();

  const collisions: EnvCheck["collisions"] = [];
  for (const [otherClientId, otherEnv] of Object.entries(input.otherClients || {})) {
    if (otherClientId === input.clientId) continue;
    for (const entry of CLIENT_ENV_MANIFEST) {
      if (entry.scope === "shared") continue;
      const mine = value(entry.name);
      const theirs = String(otherEnv[entry.name] ?? "").trim();
      if (mine && theirs && mine === theirs) {
        collisions.push({ name: entry.name, scope: entry.scope, otherClientId });
      }
    }
  }

  const unrecognized = Object.keys(input.env)
    .filter((name) => value(name) && !MANIFEST_BY_NAME.has(name))
    .sort();

  return {
    ok: missingRequired.length === 0 && collisions.length === 0,
    missingRequired,
    collisions,
    unrecognized,
  };
}

/** Human-readable check result. Prints names and scopes; never a value. */
export function formatEnvCheck(clientId: string, check: EnvCheck): string {
  const lines = [`client: ${clientId}`, check.ok ? "status: ok" : "status: BLOCKED"];
  if (check.missingRequired.length) {
    lines.push(`missing required (${check.missingRequired.length}): ${check.missingRequired.join(", ")}`);
  }
  for (const collision of check.collisions) {
    lines.push(`COLLISION ${collision.name} (${collision.scope}) is identical to client ${collision.otherClientId}`);
  }
  if (check.unrecognized.length) {
    lines.push(`not in manifest (${check.unrecognized.length}): ${check.unrecognized.slice(0, 12).join(", ")}${check.unrecognized.length > 12 ? ", …" : ""}`);
  }
  return lines.join("\n");
}
