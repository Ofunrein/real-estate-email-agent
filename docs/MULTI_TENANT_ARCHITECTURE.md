# Multi-tenant architecture: one deployment per client

Status: implemented for the first three paying clients.
Decision date: 2026-08-23.

## The shape

One GitHub repo. Per client: one Vercel project, one Neon database, one
`CLIENT_ID`, one Gmail connection, one Twilio number + Messaging Service, one
Vapi assistant + number, one Inngest app, one domain.

```
                 github.com/Ofunrein/real-estate-email-agent   (one codebase)
                                     |
        +----------------------------+----------------------------+
        |                            |                            |
   Vercel project A            Vercel project B            Vercel project C
   CLIENT_ID=client-a          CLIENT_ID=client-b          CLIENT_ID=client-c
   Neon db A                   Neon db B                   Neon db C
   Twilio number A             Twilio number B             Twilio number C
   Vapi assistant A            Vapi assistant B            Vapi assistant C
   Inngest app  …-client-a     …-client-b                  …-client-c
   app.clienta.com             app.clientb.com             app.clientc.com
```

### Why this and not one shared deployment

A shared deployment needs two things this codebase does not have yet:
per-client provider credentials encrypted and resolved per request (today they
come from `process.env`), and database-level tenant enforcement (there is no
RLS; isolation is `where client_id = $1` in application code, which is only as
good as the last query anyone wrote).

Separate deployments give the same isolation with a blast radius the type
system cannot accidentally cross: client A's process never holds client B's
`DATABASE_URL`. The cost is per-client provisioning, which is what
`scripts/provision-client.mjs` exists to make boring.

Revisit when: more than ~5 clients, or the per-deployment Vercel/Neon cost
exceeds the engineering cost of encrypted per-tenant credentials.

## Tenant identity

`lib/tenant.ts` is the only place that answers "who is this deployment?" and
"does this provider callback belong to us?".

| Question | Function | Source of truth |
|---|---|---|
| Who is this deployment? | `deploymentClientId()` | `CLIENT_ID` |
| Who is this unit of work for? | `activeClientId()` | request workspace, else `CLIENT_ID` |
| Which Inngest app? | `inngestAppId()` | derived from `CLIENT_ID` |
| Is this Twilio message ours? | `assertTwilioInboundTenant(To)` | `TWILIO_FROM` + `TWILIO_INBOUND_NUMBERS` |
| Is this Vapi call ours? | `assertVapiTenant({assistantId, phoneNumberId})` | `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID` |
| Is this Gmail push ours? | `assertGmailMailboxTenant(connected, pushed)` | connected mailbox row |

Two rules:

1. **Tenancy is never read from request input.** Not from a body field, not
   from a query param, not from unsigned OAuth state. It comes from a provider
   identifier we configured, or from an HMAC-signed state we minted.
2. **A signature is authentication; a tenant check is authorization.** Both
   run. The signature proves Twilio sent it; the `To` check proves it was sent
   to *us*.

`assert*Tenant` passes when either side is absent (`unconfigured` / `absent`)
and fails only when both are present and disagree. That keeps it layered on top
of signature verification rather than becoming a second, brittle gate that
breaks every deployment missing an optional env var.

## Cross-tenant guarantees, and what backs each one

| Guarantee | Enforced at | Test |
|---|---|---|
| Inbound SMS is signed by *our* Twilio account | `lib/twilioSignature.ts` `verifyTwilioWebhook` | `crossTenantIsolation.test.ts` |
| Inbound SMS was sent to *our* number | `assertTwilioInboundTenant` | same |
| Vapi calls match our assistant + number | `assertVapiTenant` | same |
| Gmail push matches our connected mailbox | `gmailPushReceived.ts` | same |
| OAuth callbacks cannot name another tenant | `lib/providerOAuthState.ts` | `metaConnect.test.ts`, `crossTenantIsolation.test.ts` |
| Two clients cannot share an Inngest app | `inngestAppId()` | `crossTenantIsolation.test.ts` |
| Media reads are client-scoped (DB storage) | `lib/mediaUploads.ts` signed `?t=` token + dashboard auth | `crossTenantIsolation.test.ts` |
| Dashboard cache cannot serve across tenants | `lib/dashboardDataCache.ts` (keyed map) | — |
| Two clients cannot share a credential by accident | `lib/clientEnvManifest.ts` | `clientEnvManifest.test.ts` |

## Provisioning

`node scripts/provision-client.mjs --client <id>` — dry run by default, every
value redacted. It validates, plans, and names the human inputs it will not do
itself. `--apply` refuses to run while any blocking input is outstanding.

Migrations go through `scripts/migrate.mjs`: a `schema_migrations` ledger, one
transaction per file, and the `clients` row seeded (about 45 tables have a
foreign key to it and no migration creates it).

Never automated, because each is billable, irreversible, or outward-facing:
buying a Twilio number, A2P 10DLC registration, plan upgrades, buying a Vapi
number, DNS, and the production deploy.

## Known limits

- **Isolation is per-process, not per-row.** No RLS. A future shared
  deployment needs it; three separate deployments do not, because the wrong
  database is not reachable.
- **`setRequestWorkspace` uses `enterWith`.** Documented in
  `docs/decisions/2026-08-15-production-security-hardening.md`. Fine while one
  deployment serves one tenant.
- **The token-encryption key is per-deployment, not per-tenant.** One key
  compromise exposes that client's tokens — but only that client's.
- **Cron-triggered Inngest functions read `CLIENT_ID` from env.** Correct here
  by construction; a shared deployment would need them to iterate tenants.
- **Vercel Blob media is a public URL, not a scoped one.** When
  `BLOB_READ_WRITE_TOKEN` is set, uploads go to Blob with `access: "public"` so
  Twilio's MMS fetcher can read them. The URL is unguessable but carries no
  tenant check and no expiry. Safe under one blob store per Vercel project;
  the signed-token scoping only applies to the database-storage fallback.

## See also

- `docs/OPERATOR_CHECKLIST.md` — the per-client runbook
- `docs/PILOT_GATES.md` — what must be true before pilot, and before production
- `docs/runbooks/` — incident response per failure mode
