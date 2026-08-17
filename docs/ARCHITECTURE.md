# Architecture

How the live system actually works, file by file. Every claim here maps to code in this repo; where a path is a stub or degrades to a no-op, this document says so.

Companion docs:

- [`DEVELOPER_SETUP.md`](DEVELOPER_SETUP.md) — clean-clone setup, verification commands, troubleshooting
- [`CRM_INTEGRATION.md`](CRM_INTEGRATION.md) — CRM adapter contract, per-provider support, sync behavior
- [`iris-email-stress-workflow.md`](iris-email-stress-workflow.md) — Iris scenario loop and live Gmail round-trip check
- [`decisions/`](decisions) — dated design decisions

---

## 1. Runtime shape

The product is a **Next.js 15 App Router app on Vercel** plus **Inngest** for durable background work. There is no long-running server process and no polling loop.

| Component | Where | Role |
|---|---|---|
| HTTP surface | `app/api/**/route.ts` (82 routes) | Webhooks, dashboard APIs, cron entrypoints |
| Edge middleware | `middleware.ts` | Rate limit, CSRF, body cap, security headers |
| Durable workers | `lib/inngest/functions/*` (9 functions) | Everything slow, retried, or scheduled |
| Agent brain | `lib/irisEmail.ts`, `lib/theoAgent.ts`, `lib/ariaTools.ts` | Classification, reply generation, tool calls |
| Storage | `lib/database.ts` (Neon) / `lib/googleSheets.ts`, behind `lib/dataSource.ts` | System of record |
| Dashboard | `app/page.tsx` + `components/inbox*` | Operator inbox, polls `/api/data` |

**Runtime is `nodejs`, not edge.** `app/api/inngest/route.ts` pins `runtime = "nodejs"`; webhook routes set `dynamic = "force-dynamic"` and `maxDuration = 60`.

`vercel.json` is `{"crons": []}` on purpose. Scheduling lives in Inngest cron triggers, not Vercel crons — see [Reliability](#7-reliability-and-failure-behavior).

### Deprecated Python daemon

`deprecated/agent.py` is the original 60-second Gmail polling daemon. **It is not the runtime.** Do not read it to debug Iris. See [`decisions/2026-07-15-deprecate-agent-py.md`](decisions/2026-07-15-deprecate-agent-py.md). The Python code that still matters is `core/` (sheet schema, event logger) and the `tests/test_*.py` contract tests that assert the TypeScript routes keep their shape.

---

## 2. Email path (Iris) — the primary product

This is the only channel with a push-driven durable pipeline. Trace it end to end:

```text
Gmail message arrives
  -> Gmail API watch publishes to Google Cloud Pub/Sub
  -> Pub/Sub POSTs /api/webhooks/iris-gmail-push?token=<GMAIL_PUBSUB_TOKEN>
  -> route validates token, decodes base64 payload, emits `gmail.push.received`
  -> Inngest function `gmail-push-received` (retries: 3)
       step: load inbox settings          (skip if email channel disabled)
       step: sleep 45s                    (batch quick follow-ups)
       step: resolve Gmail history target (history.list, or fallback)
       step: process Gmail messages       (classify -> reply -> label -> record)
       step: advance Gmail history cursor
       step: write audit event
```

### 2.1 The webhook is deliberately dumb

`app/api/webhooks/iris-gmail-push/route.ts` does four things: authorize, decode, `inngest.send()`, respond. It never processes Gmail after responding, because Vercel can freeze the lambda once the response is sent.

Its error semantics are unusual and intentional:

| Case | Response | Why |
|---|---|---|
| Bad token, bad JSON, missing `historyId` | **200 ACK** | A 4xx makes Pub/Sub retry forever. Blocked attempts are written to the audit log instead. |
| Inngest enqueue fails | **503** | This is the one case where a retry is wanted — the work has not been durably accepted yet. |
| `GET` without a valid token | **401** | Health-check path, no retry semantics to protect. |

### 2.2 History targeting, and why there is a fallback

`messageIdsFromGmailHistory()` pages `gmail.users.history.list` from the stored cursor (`email_accounts.gmail_history_cursor_id`, migration 021), filtered to `messageAdded` + `INBOX`, capped at 25 ids.

It returns `mode: "fallback"` — meaning "scan the unread inbox instead" — when:

- `DATABASE_URL` is unset (`database_disabled`)
- no cursor is stored yet (`missing_previous_history_id`)
- Gmail returns 404 (`history_id_too_old`, the cursor aged out)
- any other Gmail error (message truncated to 120 chars)

Two non-obvious guards in the `process Gmail messages` step:

1. **Empty history window still scans.** Gmail can advance a history id without returning `messagesAdded` rows for the filtered window. Rather than silently skipping, the code runs the unread-inbox scan before advancing the cursor.
2. **Every push runs a `needs_human` recovery sweep.** `listUnrepliedNeedsHumanEmailMessageIds(25)` re-runs parked messages through the current classifier. A stale cursor plus an unread-only scan cannot see already-read messages, so genuine real-estate inquiries could stay parked forever. Real handoffs stay parked; recoverable ones get replied.

The cursor is **not advanced in dry-run mode** (audit code `dry_run_cursor_not_advanced`), so a dry run is replayable.

### 2.3 Classification is deterministic; only prose uses an LLM

This is the most important design decision in the email path, and the reason the proof run in [`proof/iris-email-scenarios.md`](proof/iris-email-scenarios.md) is reproducible offline.

| Stage | Function | Implementation |
|---|---|---|
| Eligibility | `isIrisEligibleEmail` | Pure predicate |
| Classification | `classifyIrisEmailText` | **Pure, rule-based** (regex/keyword). No network. |
| Routing decision | `decideIrisEmailExecution` | Pure switch over the classification |
| Deterministic reply | `generateIrisEmailReply` | Template strings |
| Rich reply | `generateIrisEmailReplyRich` → `generateClaudeIrisEmailReplyText` | **Claude** (`api.anthropic.com`) |
| HTML rendering | `buildHtmlEmailReply` | Property card markup |

`classifyIrisEmailText` returns a structured `IrisEmailClassification`: `intent`, `primary_lead_role`, `secondary_roles`, `opportunity_tags`, `tone_state`, `urgency`, `compliance_flags`, `confidence`, `address`/`addresses`, `lead_fields` (timeline, budget, area, beds, current_property_status, preferred_channel), `next_best_question`, `recommended_next_action`, `human_handoff_reason`.

Because classification is pure, the routing decision is auditable and testable without mocking an LLM. Claude only writes the prose, constrained by a system prompt that forbids inventing availability, school/neighborhood claims, lending advice, legal advice, and broker judgment, and requires the body to end exactly with `Best,\nIris`. A reply that fails that terminator check is **discarded** (returns `null`) rather than sent.

Model: `IRIS_EMAIL_RESPOND_MODEL` → `CLAUDE_RESPOND` → default `claude-sonnet-4-6`, `max_tokens: 360`, `temperature: 0.4`. Token cost is priced per call and written to `request_audit_events` (`costService: "claude"`, migration 022).

### 2.4 Compliance gate

`detectIrisComplianceFlags()` scans for six flag families: `fair_housing`, `mortgage_license`, `legal`, `contract_terms`, `angry_or_complaint`, `privacy`. `SENSITIVE_FLAGS` also includes `broker_approval`.

`decideIrisEmailExecution()` blocks auto-reply — label `NEEDS_HUMAN`, `canReply: false` — when intent is `human_required`, intent is `spam`, or **any** compliance flag is sensitive. No reply is generated at all in that case.

A deliberate carve-out: `recommended_next_action: "review"` alone does **not** block auto-reply. Human review is reserved for genuine blockers, not ordinary follow-ups.

### 2.5 Send gating

Three independent switches must all agree before an email is actually sent:

```text
IRIS_EMAIL_LIVE === "true"                        -> not a dry run
IRIS_EMAIL_SEND_REPLIES === "true"                -> sending enabled
shouldAutoSendForChannel(settings, "email")       -> per-tenant DB setting (migration 011)
```

Absent any of them, Iris classifies, records, labels, and drafts — but does not send. Default posture is draft-first.

### 2.6 Thread coalescing

`coalesceIrisEmailThreadFollowUps()` groups messages by `threadId`, sorts by `receivedAt`, and merges every body in the group into the latest message, returning the superseded ones separately. Combined with the 45-second `step.sleep`, a lead who sends "tour tomorrow?" then "…actually make it Friday" gets **one** reply that has seen both.

Within a body, `Thread context for classification only:` separates the latest inbound from prior thread history. `latestEmailBody()` / `threadContextBody()` split on that marker so the classifier weighs the new message while Claude still gets memory.

---

## 3. Other channels, and where the boundary is

Non-email channels do **not** use the Gmail push pipeline. They share storage, lead memory, and property retrieval — not the email flow.

| Channel | Route | Provider | Ingest normalizer |
|---|---|---|---|
| Email | `/api/webhooks/iris-gmail-push` | Gmail Pub/Sub | (own pipeline) |
| SMS / RCS | `/api/webhooks/theo-sms` | Twilio | `twilioSmsIngestInput` |
| WhatsApp | `/api/webhooks/theo-whatsapp` | Twilio or Meta Cloud API | `twilioWhatsAppIngestInput`, `metaWhatsAppIngestInput` |
| Instagram / Messenger | `/api/webhooks/theo-meta-social` | Meta | `lib/metaSocial.ts` |
| Voice | `/api/webhooks/aria-voice`, `/api/webhooks/aria-tools/[tool]` | Vapi | `vapiVoiceIngestInput` |
| Website chat | `/api/webhooks/olivia-website` | Own form/widget | `oliviaWebsiteIngestInput` |
| Lead ads | `/api/webhooks/meta-leadgen`, `/api/webhooks/lead-capture` | Meta / generic | `lib/metaLeadgen.ts` |

**The boundary:** every adapter's only job is to translate a provider payload into one `ChannelIngestInput` (`lib/channelIngest.ts`) — who sent it, which thread, what text, what media, what consent — and hand it to `recordChannelInteraction()`. Everything downstream is channel-agnostic.

Channel string values are a hard contract (`"email"`, `"sms"`, `"rcs"`, `"whatsapp"`, `"voice"`, `"web"`, `"website"`, `"website_chat"`), as is `direction` (`"inbound"` / `"outbound"`, case-sensitive). `tests/test_channel_webhook_contracts.py` asserts route shapes so a TypeScript refactor cannot quietly break them.

Route names still say `theo-`, `aria-`, `olivia-` because live vendor webhooks already point at those URLs. Renaming them would break production integrations; the runtime personality is Iris regardless.

### The omnichannel reply pipeline

Adapters that opt into durable replies emit `message.received`, which fans out through three Inngest functions:

```text
message.received        -> message-received
    claim event dedupe   (claimEventDedupeInDatabase — insert wins, duplicates suppressed)
    upsert reply job     (reply_jobs, migration 015)
    append conversation event
    emit message.reply.generate + thread.summary.refresh

message.reply.generate  -> message-reply-generate
    build context, generate reply, emit message.reply.send

message.reply.send      -> message-reply-send  (retries: IRIS_REPLY_SEND_RETRIES)
    skip if job already "sent"
    skip if a newer inbound arrived  (hasNewerInboundForThreadInDatabase)
    claimProviderAction -> send -> completeProviderAction
```

Three separate anti-double-send guards: a dedupe claim on ingest, an idempotent `reply_jobs` status, and a provider-action claim at send time (`lib/providerSendSafety.ts`). A stale reply is dropped when a newer inbound has landed, so a retry cannot answer an outdated question.

---

## 4. Storage

### Dual-mode data source

`lib/dataSource.ts` is the only entry point callers use. It routes on one condition:

```ts
databaseEnabled()  // Boolean(process.env.DATABASE_URL)
  ? loadAgentInboxDataFromDatabase()   // Neon Postgres
  : loadAgentInboxDataFromSheets()     // Google Sheets fallback
```

Never import `lib/database.ts` or `lib/googleSheets.ts` directly from feature code.

The Sheets fallback needs `credentials.json` + `token.json` on disk. **Without a `DATABASE_URL` and without those files, `/api/data` returns 503** — see [`DEVELOPER_SETUP.md`](DEVELOPER_SETUP.md#troubleshooting).

`SheetRow = Record<string, string>`: every field is a string in both modes, which is why Postgres columns are `text` rather than typed. Field names in `lib/sheetSchema.ts` **must** stay in sync with `core/sheet_schema.py`; `tests/test_sheet_schema.py` enforces it.

### Schema

`db/migrations/001_agent_os.sql` … `026_property_context_fields.sql` — **26 migrations, applied in filename order**. Core tables from 001:

| Table | Key | Holds |
|---|---|---|
| `clients` | `id` | Tenant registry |
| `properties` | `(client_id, address)` | Listings; 30+ text columns incl. rental fields |
| `lead_memory` | `(client_id, email, phone, full_name)` | Role, intent, budget, area, timeline, consent, handoff state |
| `conversation_events` | `id` | Append-only cross-channel message timeline |
| `email_style_examples` | `id` | Opt-in few-shot tone samples |

Notable later migrations: `002` GHL sync ledger · `014` calendar/contacts OS (19 KB) · `015` omnichannel reply pipeline · `018`/`022` request audit + cost · `020`/`021` Gmail watch state and history cursor · `023` pgvector embeddings · `024` cadence tasks · `025` takeover channel scope.

Every tenant-scoped table carries `client_id` and is queried with it. `CLIENT_ID` is required env.

### Dashboard contract

`/api/data` returns `AgentInboxData` (`lib/inboxData.ts`) with **14 top-level keys, all always present**: `leads`, `events`, `voiceCalls`, `properties`, `metrics`, `threads`, `threadCategories`, `inboxCategories`, `inboxSettings`, `drafts`, `emailCapabilities`, `threadReadStates`, `channelAccounts`, `propertyHealth`. The dashboard polls it every 5s; responses carry `X-Iris-Data-Cache` / `X-Iris-Data-Cache-Mode` (`lib/dashboardDataCache.ts`).

---

## 5. Property retrieval and RAG

`lib/propertyRetrieval.ts` — `retrievePropertiesForAgent(query, limit, options, deps)`. Hybrid, in this order:

1. **Structured SQL first.** `findCandidatePropertiesFromDatabase` handles the hard facts: price, beds, baths, city, ZIP, status. When RAG is on it over-fetches a pool of `clamp(limit * 12, 25, 100)`.
2. **Semantic re-rank, only over that pool.** The query text is embedded, then matched against `property_embeddings` **joined back on address** — so vector search can only reorder rows SQL already approved. It cannot introduce a listing that fails a hard filter.
3. **Rank fusion.** `score = cosine_distance + structured_rank * 0.02`, ascending. Semantic order leads, structured rank breaks ties.
4. **Apify import fallback, only when SQL returned nothing.** `searchAndImportMissingProperties` fetches and imports live listings.

RAG is skipped when `PROPERTY_RAG_ENABLED !== "true"`, when `options.enableRag === false`, or when `channel === "voice"` (latency budget). Voice also skips the Apify fallback unless `PROPERTY_APIFY_FALLBACK_VOICE_ENABLED === "true"`.

Both the embed step and the semantic query are `.catch()`-guarded to fall back to structured results — **RAG failure degrades ranking, never availability**.

`deps` is an injected struct (`structured`, `embed`, `semantic`, `fallback`), which is how `tests/ts/propertyRetrieval.test.ts` tests fusion without Postgres or OpenAI.

### Embeddings

`lib/propertyEmbeddings.ts`. `text-embedding-3-small`, **1536 dimensions, asserted** — a wrong-size vector throws rather than corrupting the index. `propertyEmbeddingText()` builds one document per property from ~24 fields (address, neighborhood, type, price, beds/baths/sqft, features, utilities, appliances, parking, pet policy, deposit, fees, lease terms, availability, showing instructions, negotiability notes, description). `embeddingTextHash()` (SHA-256) lets the backfill skip unchanged rows.

Key: `OPENAI_API_KEY` or `PROPERTY_EMBEDDING_OPENAI_API_KEY`. **OpenAI is used only for embeddings; every customer-facing reply is Claude.**

Storage (`023_property_embeddings.sql`): `property_embeddings(client_id, address, embedding_model)` PK, `vector(1536)`, HNSW index with `vector_cosine_ops`, FK cascade from `properties`. Keeping vectors in Neon beside the listings avoids syncing live property data to a second store.

Backfill: `npm run rag:backfill`.

---

## 6. CRM integration

Summary only — full detail in [`CRM_INTEGRATION.md`](CRM_INTEGRATION.md).

`lib/crm/types.ts` defines one provider-agnostic `CrmAdapter` interface (contacts, appointments, activity logging, optional custom fields) plus an optional `CrmImportAdapter` capability detected at runtime by `hasCrmImport()`. `lib/crm/index.ts` resolves the concrete adapter from `CRM_PROVIDER` and **returns `null` when credentials are missing**, so every call site degrades instead of throwing.

Three direct adapters exist: **GHL/HighLevel** (`ghl.ts`, fully implemented, contacts + appointments + activities + custom fields + lead import), **Follow Up Boss** and **kvCORE** (interface-complete, partially stubbed). 31 providers are catalogued in `lib/crm/providers.ts` across four support paths: `direct_adapter`, `composio`, `csv_first`, `none`.

---

## 7. Reliability and failure behavior

**Durability lives in Inngest, not in HTTP handlers.** Nine registered functions (`app/api/inngest/route.ts`):

| Function | Trigger | Notes |
|---|---|---|
| `gmail-push-received` | `gmail.push.received` | retries: 3 |
| `message-received` | `message.received` | Dedupe claim + fan-out |
| `message-reply-generate` | `message.reply.generate` | |
| `message-reply-send` | `message.reply.send` | retries: `IRIS_REPLY_SEND_RETRIES` (4) |
| `thread-summary-refresh` | `thread.summary.refresh` | |
| `sheets-changed-sync` | `sheets.changed` | From Drive watch webhook |
| `gmail-watch-renewal` | cron `0 8 * * *` | Gmail watches expire by design |
| `cadence-plan` | `cadence.plan` + cron `*/15 * * * *` | Off when `ENABLE_CADENCE_TASKS=false` |
| `cadence-task-run` | `cadence.run` + cron `*/5 * * * *` | Sends due follow-ups |

Patterns worth knowing:

- **Steps are the retry boundary.** Each `step.run` is checkpointed, so a failure re-runs that step, not the whole function.
- **`step.sleep` is free.** The 45s email batching wait costs no Vercel runtime.
- **Retired function ids are ACKed, not 500'd.** `/api/inngest` answers `iris-email-minute-poll` and `composio-social-minute-poll` with `{ok: true, skipped: "retired_polling_function"}` so a stale Inngest registration cannot spam errors.
- **No signing key, no service.** In production `/api/inngest` returns 503 unless `INNGEST_SIGNING_KEY` is set, rather than serving unauthenticated function invocation.
- **Cadence is stateful, not prompt-driven.** `lib/cadenceQueue.ts` plans from recorded facts against `ClientConfig.cadence` (max touches, min gap hours, stop-on-reply, one-channel-per-day, call window hours).
- **No polling anywhere.** Vercel crons are empty; the GitHub Actions Iris email poll was removed on purpose. Inbound mail is Gmail Pub/Sub only. The one remaining Actions schedule is `sync-sheets-neon.yml` (`*/5 * * * *`), which curls `/api/cron/sync-sheets` with a bearer `CRON_SECRET`.

Every stage writes to `request_audit_events` via `lib/requestAudit.ts` with `stage` + `outcome` (`received`/`sent`/`skipped`/`blocked`/`failed`), duration, cost, and metadata. That table, not stdout, is the debugging surface.

---

## 8. Security

Layered, and mostly enforced in `middleware.ts` (matcher: `/api/:path*`, `/login`, `/reset-password`).

| Control | Where | Behavior |
|---|---|---|
| Rate limiting | `lib/sharedRateLimit.ts` → `lib/requestSecurity.ts` | Upstash Redis fixed window (`INCR`+`EXPIRE NX`, 1.5s timeout) is the real limit. API 120/min/path/IP, auth 5/15min. |
| CSRF | `crossOriginMutation()` | `Sec-Fetch-Site` first, then `Origin` vs forwarded host, then an allowlist. Webhooks/cron/inngest/auth are exempt — they carry their own secrets. |
| Body cap | `bodySizeVerdict()` | 1 MB default, 15 MB for four media upload paths. Missing/chunked `Content-Length` → **411**, not "assume 0". |
| Headers | `securityHeaders()` | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` |
| Webhook auth | `lib/webhookRequest.ts` | `assertWebhookSecret` **fails closed in production** when `CHANNEL_WEBHOOK_SECRET` is unset. Constant-time compare. |
| Twilio | `lib/twilioSignature.ts` | HMAC signature validation |
| Dashboard auth | `auth.ts` + `lib/authGuard.ts` | NextAuth v5. Google requires `email_verified` **and** an allowlisted email **and** a resolvable workspace. |
| Tenant isolation | `lib/workspaceContext.ts` | `runInRequestWorkspace()` scopes DB access per request; concurrent scopes cannot observe each other (asserted in tests). |
| Secret scan | `scripts/scan-secrets.py` | Runs in `prebuild`, so **a build cannot ship a committed credential**. |
| Load-test guard | `middleware.ts` + `lib/loadTestGuard.ts` | Requests carrying `x-iris-load-test` are refused (423) on mutating routes. |

Two documented weak spots, called out rather than hidden:

- The in-memory limiter in `requestSecurity.ts` is a **per-instance brake only** — serverless runs many instances. Without Upstash configured, distributed rate limiting is not production-safe.
- Query-string webhook secrets (`?secret=`) still work for already-configured providers but leak into access logs. The `x-lumenosis-webhook-secret` header is preferred.

Auth bypasses are env-gated and cannot fire in production: `ALLOW_LOCAL_AUTH_BYPASS=1` requires `NODE_ENV !== "production"`, `ALLOW_PREVIEW_AUTH_BYPASS=1` requires `VERCEL_ENV === "preview"`.

See [`decisions/2026-08-15-production-security-hardening.md`](decisions/2026-08-15-production-security-hardening.md).

---

## 9. Multi-tenancy and client config

`lib/clientConfig.ts` — `resolveClientConfig(env)` is **pure and unit-testable**; `clientConfig()` is the `process.env`-backed convenience. It resolves agent names per channel, brand voice, Vapi voice id, CRM provider, calendar id, human transfer number, cadence pacing, notify quiet hours, and style-training toggles, each with a documented default.

Per-request tenant scope comes from `lib/workspaceContext.ts`. Inngest events carry `clientId` and `message-reply-send` re-enters the workspace via `runInRequestWorkspace` before touching the DB — background work must not inherit whichever tenant happened to be active last.

---

## 10. Deployment

| Aspect | Value |
|---|---|
| Host | Vercel — `https://app.lumenosis.com` |
| Build | `prebuild` = secret scan + `tsc`, then `next build` |
| Node | 22 (CI pins it; `.npmrc` forces the public npm registry) |
| Migrations | `psql "$DATABASE_URL" -f db/migrations/<file>.sql`, in order |
| Inngest | `npm run inngest:sync` after changing functions, `npm run inngest:functions` to verify |
| Vapi | `npm run aria:provision` after every `lib/ariaAssistant.ts` change — that file is the source of truth, **not** the Vapi dashboard |
| CI | `.github/workflows/build-check.yml` — lint, TS tests, Python tests, proof run, staleness gate, build |

Deploy order that matters: **migrations → deploy → `inngest:sync`**. A new Inngest function that reads a column its migration has not created will fail its first invocation.

---

## 11. Design decisions worth knowing

1. **Deterministic classifier, LLM only for prose.** Routing and compliance are auditable and testable without mocking a model; `npm run proof` is reproducible offline because of it.
2. **Webhooks queue, workers work.** Vercel can freeze a lambda after the response, so no handler does real work post-response.
3. **Draft-first by default.** Three independent switches must agree before a real send. Misconfiguration produces silence, not wrong emails.
4. **Compliance blocks generation, not just sending.** No draft is written for a sensitive flag, so no operator can accidentally forward one.
5. **SQL filters, vectors re-rank.** Semantic search only reorders SQL-approved rows, so it cannot invent a listing that violates a hard constraint.
6. **`text` columns everywhere.** `SheetRow = Record<string, string>` keeps the Sheets and Postgres modes interchangeable; the cost is casting in queries.
7. **Legacy route names preserved.** `theo-`/`aria-`/`olivia-` URLs are live vendor endpoints. Cosmetic renaming is not worth an outage.
8. **Adapters return `null`, not throw.** Missing CRM credentials degrade the feature; they do not break the reply path.
9. **RentCast enrichment removed** on cost grounds — [`decisions/2026-07-15-deprecate-rentcast.md`](decisions/2026-07-15-deprecate-rentcast.md).
10. **No polling.** Push plus durable retries beats a loop that wakes the app to find nothing.
