# Real Estate Email Agent — Codebase Onboarding

---

## 1. SYSTEM OVERVIEW

This is a multi-channel real estate AI platform that automates lead qualification and communication across email, SMS/RCS, voice, and website chat. The system deploys four AI "personalities" — Iris (email), Theo (SMS/RCS), Aria (voice), and Olivia (website) — each tuned for their channel's communication norms. The platform handles inbound leads end-to-end: classifying intent, enriching property data from live sources (Zillow via Apify, RentCast, FRED mortgage rates, Census demographics), generating contextual replies, and escalating sensitive cases to human agents.

Primary users are real estate agents and brokerages who want 24/7 automated lead response without losing the warm, consultative tone of a human agent. The system tracks each lead's role (buyer/seller/renter), extracts structured fields (budget, timeline, area, beds), and runs multi-touch follow-up sequences (day 3, day 7) automatically. All conversations and lead profiles are persisted to Google Sheets (always) and optionally Neon PostgreSQL (for multi-client deployments), with a Next.js dashboard for human review.

The architecture is intentionally dual-stack: Python handles the long-running email polling loop (Iris), while TypeScript/Next.js handles real-time webhooks (Theo SMS, Aria voice, Olivia website) and the dashboard UI. Both stacks share the same data schemas (Google Sheets columns / Postgres tables) and write to the same storage layer.

---

## 2. ARCHITECTURE DIAGRAM

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         INBOUND CHANNELS                                     │
│  Gmail (OAuth poll)   Twilio SMS/RCS    Vapi Voice     Website Form/Chat    │
└──────────┬────────────────┬─────────────────┬──────────────────┬────────────┘
           │                │                 │                  │
           ▼                ▼                 ▼                  ▼
┌──────────────────┐ ┌─────────────────────────────────────────────────────────┐
│  agent.py (Iris) │ │              Next.js API Layer (/app/api/)              │
│  Python daemon   │ │  /webhooks/theo-sms     /webhooks/aria-voice            │
│  60s poll loop   │ │  /webhooks/aria-tools/* /webhooks/olivia-website        │
│  Anthropic SDK   │ │  /webhooks/theo-whatsapp /media/proxy /media/audio      │
└────────┬─────────┘ │  /api/data /api/leads /api/properties /api/metrics      │
         │           └──────────────────────┬──────────────────────────────────┘
         │                                  │
         └──────────────┬───────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        SHARED STORAGE LAYER                                  │
│                                                                              │
│  Google Sheets (always)          Neon PostgreSQL (optional, multi-client)   │
│  - properties tab (19 cols)      - properties table                         │
│  - lead_memory tab (21 cols)     - lead_memory table                        │
│  - conversation_events (18 cols) - conversation_events table                │
│                                  - voice_calls table                        │
│  state.json (Iris local only)    - clients table                            │
│  - replied_ids                   - email_style_examples                     │
│  - lead_state per thread         - ghl_sync_events                          │
│  - lead_memory per email                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     EXTERNAL ENRICHMENT SERVICES                             │
│  Anthropic (Haiku classify, Sonnet reply)   Apify (Zillow scrape, comps)   │
│  FRED API (mortgage rates, 24h cache)       Census ACS (ZIP demographics)  │
│  RentCast (rental valuation)                HubSpot (CRM upsert)           │
│  GoHighLevel (multi-tenant CRM)             Twilio (SMS send + alert)      │
│  Calendly (showing links)                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     NEXT.JS DASHBOARD (port 3000)                            │
│  app/page.tsx (SSR load)                                                    │
│  components/AgentInboxClient.tsx (client, 5s poll)                         │
│  Views: overview | email | sms | whatsapp | voice | website_chat |          │
│         properties                                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. TECH STACK

**Python backend (Iris daemon):**
- Python 3.x
- `anthropic` SDK — Haiku 4.5 (classify), Sonnet 4.6 (replies)
- `google-api-python-client` + `google-auth-*` — Gmail OAuth2, Sheets API
- `requests` — Apify, FRED, Census, RentCast, HubSpot, Twilio REST
- `python-dotenv` — `.env` loading
- Runtime: Railway / Render / any VPS ($5/month)

**Node.js / Next.js layer:**
- Node.js 20.x
- Next.js 16.0.0
- React 19.0.0 + TypeScript 5.7
- `pg` 8.21.0 — Neon PostgreSQL client
- `googleapis` 144.0.0 — Sheets fallback reads
- No UI component library — all bespoke CSS

**AI models:**
- `claude-haiku-4-5` — classification, lead enrichment (fast, cheap)
- `claude-sonnet-4-6` — email/SMS reply generation (quality)
- OpenAI `gpt-4o-mini` — Aria voice (Vapi-managed, configured in `lib/ariaAssistant.ts`)

**External services:**
- Apify — Zillow detail scraper, sold comps, active listing search
- Twilio — SMS/RCS send/receive, MMS photos, call routing
- Vapi — voice call management, tool call dispatch, transcription
- Google Gmail + Sheets (OAuth2)
- Neon — serverless Postgres
- HubSpot / GoHighLevel — optional CRM
- FRED, Census ACS, RentCast — property/market enrichment

---

## 4. DATA FLOW (step by step)

### Email lead arrival (Iris):

1. `main()` fires poll loop every 60 seconds
2. `get_new_messages(gmail, since_ts, my_email)` — queries Gmail API for unread messages after `startup_ts`
3. Skip if `msg_id` in `state["replied_ids"]` (dedup guard)
4. `parse_message(msg)` — extract: from address, subject, plain text body (strips quoted lines)
5. `get_thread_context(gmail, thread_id, msg_id, limit=4)` — fetch prior 4 messages for Claude context
6. `classify_email(body, subject, thread_context)` — Haiku call, returns: `intent`, `lead_role`, `opportunity_tags`, `lead_fields` (budget, timeline, area, beds), `extracted_email`, `extracted_phone`, `extracted_name`, `addresses[]`, `compliance_flags[]`, `no_signal`, `confidence`
7. Check compliance flags → if any sensitive flag: apply `NEEDS_HUMAN` Gmail label, skip reply, log event
8. Check confidence < 35% → human handoff
9. `update_lead_memory(state, thread_id, classification)` — upsert in-memory lead profile
10. `upsert_lead_memory(sheets, lead_data)` → write to `LEAD_MEMORY_TAB` in Google Sheets
11. Branch on intent:
    - `property_details` → `apify_zillow_lookup(address)`, optionally `get_sold_comps(zip)`, `get_mortgage_rates()`, `get_neighborhood_stats(zip)` → `generate_property_html(data)`
    - `property_search` → `apify_zillow_search(area, max_price, min_beds)` → `generate_search_reply(results)`
    - `showing_request` → `generate_showing_reply()`
    - `buyer/seller/renter_lead` → `generate_lead_reply(classification)` (qualification question)
12. Sonnet call → generates HTML + plain text email body
13. `send_reply(gmail, parsed, html_body, text_body)` — Gmail API, uses thread `references` header
14. Apply `AUTO_REPLIED` Gmail label
15. `append_conversation_event(sheets, event_row)` → write to `CONVERSATION_EVENTS_TAB`
16. Append `msg_id` to `state["replied_ids"]`, persist `state.json`
17. `hubspot_upsert_contact(...)` → create/update HubSpot contact, add note
18. If hot lead: `send_sms(AGENT_PHONE, handoff_summary)`
19. `check_followups(gmail, sheets, state)` → if `lead.last_contact_ts` > 3 days and no `followup1_sent`: send day-3 follow-up; same logic for day-7

### SMS lead arrival (Theo):

1. Twilio fires POST to `/api/webhooks/theo-sms`
2. `assertWebhookSecret(request)` — 401 if mismatch
3. Log inbound to Neon `conversation_events` (direction: inbound)
4. Wait `THEO_REPLY_DEBOUNCE_MS` (~2500ms) — if newer inbound arrives for same phone, exit
5. Read thread context: prior events for this phone from Neon
6. Extract property addresses from SMS body
7. Enrich within `THEO_ENRICHMENT_TIMEOUT_MS` (14s): Zillow via Apify, RentCast, HubSpot
8. Claude Haiku/Sonnet → generate SMS text (no emoji, no em-dashes, no links by rule)
9. If photos enabled + address found: attach via `/api/media/proxy` MMS URL
10. `Twilio.send()` → SMS from `TWILIO_FROM` or RCS via messaging service SID
11. Log outbound to Neon, SMS alert to `AGENT_PHONE` if `needs_human`
12. Return TwiML XML (or JSON if `?debug=json`)

### Dashboard display:

1. `app/page.tsx` SSR: calls `loadAgentInboxData()` → `lib/dataSource.ts`
2. `dataSource.ts`: `databaseEnabled()` ? `loadAgentInboxDataFromDatabase()` : `loadAgentInboxDataFromSheets()`
3. Returns `AgentInboxData`: `{ leads, events, properties, voiceCalls, metrics, threads, propertyHealth }`
4. Hydrates `AgentInboxClient` with SSR data
5. Client mounts → `useEffect` sets 5s interval → polls `/api/data?ts=<Date.now()>` with `cache: "no-store"`
6. `setDashboardData(nextData)` re-renders all views on each successful poll

---

## 5. BACKEND COMPONENTS

### `agent.py` (2782 lines) — Iris email daemon

**Entry:** `main()` — infinite loop, `POLL_INTERVAL` seconds (default 60)

**Key functions:**

| Function | Purpose |
|----------|---------|
| `main()` | Daemon loop: auth → poll → process → sleep |
| `process_message(gmail, sheets, state, msg, my_email)` | Per-message orchestrator |
| `classify_email(body, subject, thread_context)` | Haiku classification → intent/fields/flags |
| `generate_property_html(property_data)` | HTML+text email with hero photo, comps, rates, similar homes |
| `generate_search_reply(results)` | Multi-card listing grid email |
| `generate_lead_reply(classification)` | Qualification email (next best question) |
| `generate_showing_reply()` | Calendly link reply |
| `check_followups(gmail, sheets, state)` | Day-3 / day-7 cadence, marks leads cold |
| `apify_zillow_lookup(address)` | Property detail scrape (actor: maxcopell, fallback: kawsar) |
| `apify_zillow_search(area, max_price, min_beds)` | Live listing search (actor: truefetch) |
| `get_sold_comps(zip)` | Recently sold comparables (actor: crawlerbros) |
| `rentcast_lookup(address)` | Rental valuation + stats |
| `get_mortgage_rates()` | FRED 30yr/15yr, 24h cached |
| `get_neighborhood_stats(zip)` | Census ACS median income + population |
| `hubspot_upsert_contact(...)` | CRM create/update, HubSpot API v3 |
| `send_sms(to, body)` | Twilio REST SMS to agent phone |
| `_claude(model, system, user, max_tokens)` | Universal Anthropic wrapper: retry (5×, exponential), cost tracking |
| `build_handoff_summary(thread_id, lead_data, classification)` | Structured summary for human agent |
| `update_lead_memory(state, thread_id, classification)` | In-memory lead profile upsert |
| `load_state() / save_state(state)` | Read/write `state.json` |
| `_timed_request(method, url, label, **kwargs)` | All HTTP calls, logs elapsed ms |
| `_retry_delay(attempt)` | Exponential backoff: 2s base → 60s max |

**State file** (`state.json`):
```json
{
  "startup_ts": "2026-05-18T01:57:10.206731+00:00",
  "replied_ids": ["msg_id_1", "msg_id_2", ...],
  "lead_state": {
    "<thread_id>": {
      "intent": "buyer_lead",
      "collected": {"timeline": "3 months", "budget": "$450k", "area": "Austin"},
      "lead_email": "lead@example.com",
      "subject": "Looking for homes",
      "last_message_id": "...",
      "references": "...",
      "last_contact_ts": 1748220123.45,
      "followup1_sent": false,
      "followup2_sent": false,
      "cold": false
    }
  },
  "lead_memory": {
    "<email>": { "no_count": 0, "compliance_flags": [] }
  }
}
```

### `core/` (6 files)

| File | Purpose |
|------|---------|
| `sheet_schema.py` | Header lists for all 3 Sheets tabs, `_sheet_header_key()` normalizer |
| `sheets_store.py` | CRUD: `read_table()`, `append_row()`, `update_row()`, `batch_update_rows()`, `ensure_workbook_schema()` |
| `event_logger.py` | `upsert_lead_memory()`, `append_conversation_event()`, `build_lead_memory_update()`, `build_conversation_event()` |
| `lead_matching.py` | `find_lead_index()` — dedup by phone/email/name normalization |
| `properties_repair.py` | `repair_property_rows()`, `normalize_property_record()`, shifted-column detection |
| `property_hygiene.py` | `validate_property()`, `build_hygiene_report()`, `find_duplicate_groups()`, `missing_core_fields()` |

### `channels/iris_email.py`

Thin bootstrap: reads `ENABLE_EMAIL_AGENT` env flag, calls `agent.main()` if true.

### `scripts/` (30 total, key ones)

| Script | Purpose |
|--------|---------|
| `aria-provision.mjs` | Deploy Aria voice assistant config to Vapi |
| `sync-sheets-to-db.mjs` | Pull Sheets → Neon (all three tabs) |
| `sync-db-to-sheets.mjs` | Push Neon → Sheets |
| `import-zillow-apify-properties.mjs` | Bulk import from Apify dataset |
| `backfill_neon_from_sources.py` | Seed Neon from CSV / Sheets |
| `enrich_neon_ai.py` | Anthropic-powered property enrichment batch |
| `fill-rate-oracle.mjs` | Analytics: fill rate per field |
| `sync-events-to-ghl.mjs` | Push conversation events to GoHighLevel |

---

## 6. AI AGENTS (PERSONALITIES)

### Iris — Email Agent

- **File:** `agent.py` (daemon) + `channels/iris_email.py` (entry)
- **Channel:** Gmail
- **Trigger:** Poll every 60s
- **Personality:** Warm, professional real estate consultant. Concise sentences. No bullet lists in replies. Signs as "Iris" from the brokerage. Never discusses competitors.
- **Classification model:** `claude-haiku-4-5` (max 512 tokens)
- **Reply model:** `claude-sonnet-4-6` (quality prose, HTML email)
- **Intents handled:** `property_search`, `property_details`, `showing_request`, `buyer_lead`, `seller_lead`, `renter_lead`, `human_required`, `spam`
- **Compliance escalations:** `fair_housing`, `mortgage_license`, `legal`, `contract_terms`, `angry_or_complaint`, `privacy`, `broker_approval`
- **Follow-up cadence:** Day 3 (soft check-in), Day 7 (final warm follow-up), then mark cold
- **Brand voice:** Optional few-shot suffix from `email_style_examples` Postgres table if `ENABLE_STYLE_TRAINING=true`
- **Cost per email:** ~$0.007 (Haiku classify + Apify + Sonnet reply)

### Theo — SMS/RCS/WhatsApp Agent

- **Files:** `app/api/webhooks/theo-sms/route.ts`, `lib/theoAgent.ts`, `lib/theoData.ts`
- **Channel:** Twilio SMS, RCS, WhatsApp
- **Trigger:** Twilio inbound webhook POST
- **Personality:** Crisp, no-nonsense texting style. No emoji. No em-dashes. No links. Short sentences. Never sounds like a bot.
- **Debounce:** 2.5s wait before replying (combines rapid follow-up texts)
- **Enrichment budget:** 14s total (`THEO_ENRICHMENT_TIMEOUT_MS`)
- **Intents:** Same classification schema as Iris
- **SMS photos:** Optional MMS/RCS property photos via `/api/media/proxy` (controlled by `ENABLE_SMS_IMAGES`)
- **Hot lead alert:** SMS to `AGENT_PHONE` on `needs_human` classification

### Aria — Voice Agent

- **Files:** `lib/ariaAssistant.ts` (config), `lib/ariaTools.ts` (tool handlers), `app/api/webhooks/aria-voice/route.ts`
- **Channel:** Vapi-managed voice calls
- **Phone:** Configurable via `VAPI_PHONE_NUMBER`
- **Trigger:** Inbound call or scheduled outbound (`npm run aria:followup`)
- **Personality:** Friendly, warm, efficient. Natural speech patterns. Confirms details before acting. Knows when to transfer.
- **Voice:** Vapi `nova` TTS, `gpt-4o-mini` base model (Vapi-managed, not Anthropic)
- **Tools (Vapi function calls):**
  - `search_properties_by_address` — Zillow/Sheets lookup
  - `search_properties_by_criteria` — beds/price/area search
  - `get_property_context` — comps, rates, neighborhood stats
  - `book_showing` — calendar + GHL appointment
  - `transfer_to_human` — route to `HUMAN_TRANSFER_NUMBER`
- **Deployment:** Config must be synced to Vapi via `npm run aria:provision` after `lib/ariaAssistant.ts` changes
- **Data persistence:** `voice_calls` Neon table + `conversation_events`

### Olivia — Website Chat / Form Agent

- **File:** `app/api/webhooks/olivia-website/route.ts`
- **Channel:** Website form / chat intake
- **Trigger:** POST from website form submission
- **Current state:** Logging/monitoring only. If phone + `sms_consent=true` in payload, triggers Theo to send first SMS reply.
- **No auto-reply:** Olivia itself does not generate replies yet. Routes to Theo for SMS follow-up.

---

## 7. FRONTEND COMPONENTS

### `components/AgentInboxClient.tsx` (1709 lines)

**State variables (14):**

| Variable | Type | Purpose |
|----------|------|---------|
| `dashboardData` | `AgentInboxData` | Full data snapshot from `/api/data` |
| `refreshError` | `string \| null` | Error message from failed poll |
| `lastRefreshedAt` | `string \| null` | ISO timestamp of last successful load |
| `view` | `ViewType` | Active view: `overview\|email\|sms\|whatsapp\|voice\|website_chat\|properties` |
| `selectedPropertyIndex` | `number` | Active row in property table |
| `mobileCardIndex` | `number \| null` | Property index for phone mockup preview |
| `propertySort` | `{key, direction}` | Sort column + asc/desc |
| `showPropertyReviewOnly` | `boolean` | Filter to properties with missing fields |
| `propertySearch` | `string` | Property table filter text |
| `selectedThreadKey` | `string \| null` | Active conversation thread ID |
| `threadSearch` | `string` | Thread list filter text |

**Views (7):**

| View | Shows |
|------|-------|
| `overview` | Cross-channel activity feed, all recent events |
| `email` | Iris email threads + rendered HTML emails |
| `sms` | Theo SMS threads + message bubbles |
| `whatsapp` | WhatsApp threads (logged, no reply) |
| `voice` | Aria voice call transcripts + audio player |
| `website_chat` | Olivia website form leads |
| `properties` | Property table + mobile card preview |

**useEffect hooks (6):**

1. `[data]` — sync SSR prop to state, update `lastRefreshedAt`
2. `[view]` — clear `threadSearch` on channel switch
3. `[propertySearch, showPropertyReviewOnly]` — reset `selectedPropertyIndex` + `mobileCardIndex`
4. `[filteredThreads, selectedThreadKey, view]` — auto-select first thread if selection invalid
5. Polling — `/api/data` every 5s, cancelled flag + `clearInterval` on unmount
6. `[mobileCardIndex]` — Escape key listener for mobile card close

**Key sub-components (inline):**

| Component | Lines | Purpose |
|-----------|-------|---------|
| `EmailRenderedHtml` | 71–96 | `dangerouslySetInnerHTML` of `rewriteEmailHtmlForInbox()` output; `img.onerror` strips broken images |
| `MessageContent` | 98–130 | SMS/WhatsApp bubble: plain text or HTML, extracted image thumbnails |
| `PropertyTable` | 520–653 | Sortable property grid; 6 sort keys; keyboard nav (Enter/Space/V) |
| `VoiceCallCard` | 1017–1070 | Transcript turns, audio proxy player, duration, fallback details |

**Channel routing:**
- Sidebar `nav-button` clicks set `view` directly
- `openEventThread(event)` derives channel from `event.channel`, sets `view` + `selectedThreadKey`
- Thread grouping: `buildChannelThreads()` groups by `conversationKey()` (email, phone, or thread_ref)
- Voice: `buildVoiceCallThreads()` groups by phone/thread_ref/call_id

---

## 8. DATA SCHEMA

### Google Sheets tabs (all values are strings):

**PROPERTIES_TAB (19 fields):**
```
address, price, beds, baths, city, state, zip,
description, neighborhood, property_type, features,
days_on_market, photo_url, sqft, year_built,
status, listing_url, agent_name, agent_email
```

**LEAD_MEMORY_TAB (21 fields):**
```
email, phone, full_name, lead_source, source_detail,
lead_role, intent, property_interest, budget, area,
timeline, preferred_channel, sms_consent, call_consent,
last_channel, last_ai_touch_at, assigned_owner,
handoff_status, handoff_reason, next_action, summary
```

**CONVERSATION_EVENTS_TAB (18 fields):**
```
event_at, channel, direction, email, phone,
full_name, source, thread_ref, agent_name,
human_owner, event_type, message_text, summary,
transcript_url, recording_url, ai_action,
handoff_reason, status
```

### Neon Postgres tables:

- `clients (id, name, google_sheet_id, default_owner_email, created_at, updated_at)`
- `properties` — mirrors PROPERTIES_TAB + `client_id, source, updated_at`; key: `(client_id, address)`
- `lead_memory` — mirrors LEAD_MEMORY_TAB + `client_id, updated_at`; key: `(client_id, email, phone, full_name)`
- `conversation_events` — mirrors CONVERSATION_EVENTS_TAB + `client_id, created_at`; serial PK
- `email_style_examples (id, client_id, example_text, approved, created_at)` — brand voice few-shots
- `voice_calls (id, client_id, call_id, participant_phone, duration_s, disposition, intents[], transcript, recording_url, created_at)`
- `ghl_message_sync (id, client_id, ghl_contact_id, event_ref, synced_at)`

### `AgentInboxData` (TypeScript shape from `lib/dataSource.ts`):

```typescript
{
  leads: SheetRow[];               // LEAD_MEMORY_TAB rows
  events: SheetRow[];              // CONVERSATION_EVENTS_TAB rows
  properties: SheetRow[];          // PROPERTIES_TAB rows
  voiceCalls: SheetRow[];          // voice_calls joined to SheetRow shape
  metrics: {
    lead_count: number;
    event_count: number;
    property_count: number;
    needs_human: number;
    inbound_messages: number;
    outbound_replies: number;
    channels: Record<Channel, number>;
  };
  threads: Record<string, SheetRow[]>;   // keyed by conversationKey
  propertyHealth: {
    total: number;
    missing_core: number;
    duplicate_groups: number;
  };
}
```

### `SheetRow` type:

```typescript
type SheetRow = Record<string, string>;  // lib/sheetSchema.ts
```

All values strings. Keys are header strings lowercased + underscored via `_sheet_header_key()`.

---

## 9. CSS ARCHITECTURE

### Root CSS variables (24, defined in `globals.css` or equivalent):

```css
/* Surfaces */
--background: #f5f6f3
--surface: #ffffff
--surface-strong: #f7f8f4
--surface-wash: #eef1ec

/* Text */
--ink: #131619
--muted: #6b7280
--muted-strong: #39414a
--nav-text: #f3f7f2

/* Borders */
--line: #dde2d9
--line-strong: #bfc8bd

/* Nav */
--nav: #101817
--nav-soft: #172322

/* Brand */
--accent: #b4492f
--accent-dark: #7f2f22
--teal: #0e766c
--green: #246b4f
--amber: #b0822f
--blue: #315f8f

/* Shadows */
--shadow: 0 24px 70px rgba(19,22,25,0.08)
--shadow-tight: 0 10px 28px rgba(19,22,25,0.06)

/* Layout */
--thread-list-width: clamp(200px, 18vw, 248px)
--thread-bubble-max: min(92%, 980px)
--thread-bubble-voice-max: min(85%, 680px)
--context-rail-width: clamp(280px, 24vw, 320px)
```

### Typography:

- **Body:** `"Avenir Next", "SF Pro Text", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI"`
- **Display (h1):** `"Avenir Next", "SF Pro Display"`
- **Weights used:** 700, 750, 800, 850, 900
- **Letter-spacing:** 0.08em on uppercase labels (`.eyebrow`, `.side-label`)

### Responsive breakpoints:

- **1160px** — 6-col → 3-col grids, context rail goes 2-col, detail panel loses sticky
- **860px** — sidebar collapses, conversation inbox goes 1-col
- **640px** — all panels 1-col, padding drops to 16px, message padding 10px 12px

### CSS class taxonomy:

**Layout shell:**
`app-shell`, `sidebar`, `main`, `topbar`, `workspace`, `panel`, `section`, `property-layout`

**Navigation:**
`nav-button` (`.active` modifier), `nav-count`, `side-section`, `side-label`, `side-footer`, `brand`, `brand-mark`, `brand-title`, `brand-subtitle`

**Metrics / status:**
`source-card`, `source-meter`, `sync-status` (`.secondary`, `.warning`), `metrics-grid`, `metric`, `metric-label`, `metric-button`

**Channel strip:**
`channel-strip`, `channel-tile` (`.active`), `channel-avatar`, `channel-agent`

**Conversation list (left pane):**
`conversation-panel`, `conversation-inbox`, `conversation-list-column`, `conversation-list-header`, `conversation-list`, `conversation-list-item` (`.active`), `conversation-row-top`, `conversation-row-bottom`, `conversation-preview`, `conversation-search`, `conversation-empty`

**Thread viewer (right pane):**
`conversation-thread-column`, `thread`, `selected-thread`, `needs-human`, `thread-head`, `thread-messages`, `thread-status-stack`, `handoff-badge` (`.compact`), `handoff-note`, `handoff-summary`

**Messages:**
`message` (`.outbound`, `.inbound`), `message-meta`, `message-content`, `message-text`, `message-images`, `message-image-link`, `message-image`, `message-handoff`, `image-load-failed`, `empty-message`

**Voice:**
`voice-call-card`, `voice-call-card-head`, `voice-transcript`, `voice-message-text`, `voice-call-report`, `voice-recording`, `voice-raw-transcript`, `voice-call-stack`, `voice-thread`, `voice-empty`

**Properties table:**
`property-layout`, `property-panel`, `property-toolbar`, `property-toolbar-meta`, `property-search`, `property-table-wrap`, `property-table` (thead/tbody), `property-address`, `property-subtitle`, `sort-header` (`.active`), `status`, `missing-pill`, `complete-pill`

**Property detail panel:**
`property-photo` (`.large`, `.missing`), `property-preview-button`, `preview-icon`, `property-detail-panel`, `property-detail-media`, `property-detail-preview`, `property-detail-body`, `eyebrow`, `property-detail-grid`, `property-copy-block`, `property-link-row`, `missing-block`, `missing-list`

**Mobile phone mockup:**
`property-card-stage`, `property-card-scrim`, `property-phone`, `phone-bar`, `phone-notch`, `phone-card`, `phone-hero`, `phone-hero-copy`, `phone-close`, `phone-content`, `phone-facts`, `phone-address`, `phone-meta-grid`, `phone-description`, `phone-features`, `phone-actions`

**Context rail (right sidebar):**
`context-rail`, `context-card`, `rail-label`, `rail-metric-grid`, `rail-facts` (`.compact`), `human-review-card`, `review-stack`, `review-item`, `flow-balance`, `readiness-ring`

**Health / activity:**
`health-panel`, `health-score`, `health-grid`, `row-stack`, `table-row`, `activity-row`, `row-title`, `row-body`, `row-meta`

**Detail panels:**
`detail-panel`, `detail-list`, `detail-item`, `panel-header`, `panel-title`, `panel-kicker`, `panel-actions`, `filter-clear`

**Empty states:**
`empty`, `empty-state`, `empty-icon`, `notice-panel`, `thread-viewer-empty`

---

## 10. EXTERNAL INTEGRATIONS

### Gmail API (Iris only)
- Auth: OAuth2 `credentials.json` + `token.json` on disk
- Scopes: `gmail.modify`, `spreadsheets`
- Operations: list messages, get message, get thread, send reply, modify labels
- Labels applied: `NEEDS_HUMAN`, `AUTO_REPLIED`, `IRIS_LEAD`, `IRIS_SPAM`

### Google Sheets API (Python + TypeScript)
- Auth: Same OAuth2 token as Gmail (Python), Service account or same OAuth (TS)
- Python `core/sheets_store.py`: `read_table()`, `append_row()`, `update_row()`
- TypeScript `lib/sheetsDataSource.ts`: Reads all three tabs, returns `SheetRow[]`
- Three tabs: properties, lead_memory, conversation_events

### Twilio (Theo)
- Inbound: Twilio webhook POST → `/api/webhooks/theo-sms`
- Outbound: `twilio.messages.create()` with body, from, to
- MMS: `mediaUrl` array of `/api/media/proxy?url=...` image URLs
- Alert SMS: `send_sms(AGENT_PHONE, body)` from Python (agent.py) and TS route
- Auth: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`

### Vapi (Aria)
- Config: `lib/ariaAssistant.ts` → JSON posted to Vapi API via `npm run aria:provision`
- Inbound lifecycle: POST `/api/webhooks/aria-voice` (`end-of-call-report`, `tool-calls`, `status-update`)
- Tool dispatch: POST `/api/webhooks/aria-tools/[tool]` — returns `{ results: [...] }`
- Auth: `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`

### HubSpot (optional)
- `hubspot_upsert_contact()` — search by email → create or update properties
- `hubspot_add_note()` — attach handoff summary as engagement note
- Auth: `HUBSPOT_ACCESS_TOKEN` (OAuth) or `HUBSPOT_API_KEY` (legacy)

### GoHighLevel (optional)
- Contact read/write, appointment booking
- `sync-events-to-ghl.mjs` pushes conversation events
- `npm run aria:followup` reads GHL cadence queue for outbound calls
- Auth: `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`

### Apify
- Actor calls: `POST https://api.apify.com/v2/acts/<actor>/run-sync-get-dataset-items`
- Four actors: `maxcopell/zillow-detail-scraper`, `kawsar/Affordable-Zillow-Details-Scraper`, `truefetch/zillow-property-listing`, `crawlerbros/zillow-sold-comps`
- Auth: `APIFY_TOKEN` in bearer header
- Per-call cost: $0.002–$0.01 depending on actor

---

## 11. HOW TO RUN

### Required `.env` vars:

```bash
# Core AI
ANTHROPIC_API_KEY=

# Gmail (paths to OAuth files)
GMAIL_CREDENTIALS_PATH=./credentials.json
GMAIL_TOKEN_PATH=./token.json

# Google Sheets
GOOGLE_SHEET_ID=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=+1...
AGENT_PHONE=+1...

# Channel webhooks
CHANNEL_WEBHOOK_SECRET=

# Optional — DB
DATABASE_URL=

# Optional — enrichment
APIFY_TOKEN=
FRED_API_KEY=
CENSUS_API_KEY=
RENTCAST_API_KEY=

# Optional — CRM
HUBSPOT_ACCESS_TOKEN=
GHL_PRIVATE_INTEGRATION_TOKEN=
GHL_LOCATION_ID=

# Optional — Vapi
VAPI_API_KEY=
VAPI_ASSISTANT_ID=
VAPI_PHONE_NUMBER_ID=

# Feature flags
ENABLE_EMAIL_AGENT=true
ENABLE_SMS_IMAGES=false
ENABLE_STYLE_TRAINING=false
POLL_INTERVAL=60
THEO_REPLY_DEBOUNCE_MS=2500
THEO_ENRICHMENT_TIMEOUT_MS=14000
DASHBOARD_REFRESH_MS=5000
```

### Commands:

```bash
# Install Node deps
npm install

# Setup Neon DB (run once)
npm run setup:neon

# Sync Sheets → DB (initial seed)
npm run sync:sheets

# Start Next.js dashboard (port 3000)
npm run dev

# Start Iris email agent (Python, separate process)
python agent.py
# or
python -m channels.iris_email

# Deploy Aria voice config to Vapi (after editing lib/ariaAssistant.ts)
npm run aria:provision

# Run outbound voice follow-up calls
npm run aria:followup

# Sync DB → Sheets
npm run sync:db

# Property enrichment batch
python scripts/enrich_neon_ai.py
```

### First-time Gmail OAuth:

```bash
# Run locally to generate token.json
python agent.py
# Opens browser, complete OAuth flow, token.json created
# Upload credentials.json + token.json to hosting provider
```

---

## 12. KEY COUPLING POINTS

### Backend → Frontend contracts (DO NOT BREAK):

**`SheetRow` key names** — All TypeScript reads properties by string key matching the lowercased/underscored column header. If Python renames a column in `sheet_schema.py`, the TypeScript reads break silently (returns `undefined`). The mapping is done by `_sheet_header_key()` in Python and the equivalent normalization in TypeScript. Both must stay in sync.

**`channel` field values** — `channelFor(event)` in `lib/inboxData.ts` maps `event.channel` strings to the 5 view types. Valid values: `"email"`, `"sms"`, `"rcs"`, `"whatsapp"`, `"voice"`, `"web"`, `"website"`, `"website_chat"`. If Python writes a different channel string, events vanish from the dashboard silently.

**`direction` field values** — `"inbound"` and `"outbound"` only. Controls message bubble styling in `MessageContent`. Case-sensitive.

**`status` field** — `"needs_human"` triggers `needs-human` CSS class on thread list items and `handoff-badge`. Other status values are display-only.

**`handoff_status` in lead_memory** — `"needs_human"` value drives the human review queue in context rail.

**`event_type` field** — Used for icon/label selection in thread views. Valid values expected by frontend: `"inbound_email"`, `"outbound_email"`, `"inbound_sms"`, `"outbound_sms"`, `"voice_call"`, `"website_contact"`.

**`/api/data` response shape** — `AgentInboxData` interface. All 8 top-level keys must be present. `metrics.channels` must be `Record<Channel, number>`. Frontend destructures these directly with no optional chaining in most places.

**`CHANNEL_WEBHOOK_SECRET`** — Must match between Twilio webhook config and `assertWebhookSecret()`. Single secret for all webhook routes.

**`/api/media/proxy`** — Twilio MMS `mediaUrl` values in Theo point to this. If the proxy route URL structure changes, existing SMS photo links break. Route must remain at `/api/media/proxy?url=<...>`.

**`lib/ariaAssistant.ts`** — Aria tool names in this file must exactly match the dynamic route segments in `/api/webhooks/aria-tools/[tool]/route.ts`. Adding a tool to the assistant without adding a route handler causes a 404 during live calls.

---

## 13. UI OVERHAUL IMPACT ANALYSIS

### Backend contracts that MUST stay stable:

1. **`SheetRow` field names** — 58 fields across 3 tabs. Any rename in `sheet_schema.py` requires the same rename in `lib/sheetSchema.ts` and all TypeScript consumers. Safe to add new fields; dangerous to rename existing ones.

2. **`/api/data` response shape** — `AgentInboxData` interface. Every key must be present. Frontend has no null guards on top-level keys in most render paths.

3. **`channel` string enum** — The 5 view type strings come from `event.channel` field values. Backend must keep writing the same values.

4. **`direction` values** — `"inbound"` / `"outbound"` only. CSS classes `.inbound` / `.outbound` are applied conditionally on these exact strings.

5. **`status === "needs_human"`** — Drives `needs-human` CSS class and human review queue. This string is a hard coupling.

6. **Webhook URL paths** — `/api/webhooks/theo-sms`, `/api/webhooks/aria-voice`, `/api/webhooks/aria-tools/[tool]`, `/api/webhooks/olivia-website`, `/api/media/proxy` — all registered externally with Twilio/Vapi. Cannot change without updating those vendor configs.

### CSS classes referenced from TypeScript (dangerous to rename):

These classes are applied conditionally via template literals in `AgentInboxClient.tsx` — renaming them in CSS without updating the TypeScript string references breaks the styling silently:

```typescript
// Conditional class applications in AgentInboxClient.tsx
`nav-button ${view === x ? "active" : ""}`
`channel-tile ${view === x ? "active" : ""}`
`conversation-list-item ${selected ? "active" : ""}`
`message ${event.direction === "outbound" ? "outbound" : "inbound"}`
`thread ${key === selectedThreadKey ? "selected-thread" : ""}`
`needs-human`          // applied when status === "needs_human"
`handoff-badge compact` // applied in compact thread views
`sort-header ${sort.key === k ? "active" : ""}`
`missing-pill` / `complete-pill` // applied based on missing_core_fields()
`property-photo missing` // applied when no photo_url
`image-load-failed`    // applied via img.onerror DOM manipulation
`sync-status secondary` / `sync-status warning` // applied on refresh state
```

### Safe to change in a UI overhaul:

- All CSS variable values (colors, spacing, shadows) — no TypeScript references
- CSS values/properties within existing selectors
- HTML structure inside JSX (element types, nesting) as long as class names stay
- Adding new CSS classes
- Font stack, font size, border radius, animation
- Layout within a view (grid columns, flex order)
- All content in `globals.css` / `page.module.css` that is purely decorative

### Dangerous to change without TypeScript updates:

- Any CSS class name applied conditionally from TypeScript (full list above)
- `--thread-list-width`, `--context-rail-width` — if layout depends on these being set on specific elements that JavaScript measures (check for `getComputedStyle` / `offsetWidth` usage before removing)
- The `dangerouslySetInnerHTML` HTML structure in `EmailRenderedHtml` — `rewriteEmailHtmlForInbox()` injects specific class names (`image-load-failed`) and strips scripts; changes to the sanitizer output format need coordinated CSS updates
- The `loading="lazy"` + `onerror` pattern on `PropertyPhoto` — tightly coupled to `image-load-failed` class

### Recommended overhaul approach:

1. Keep all conditionally-applied class names exactly as-is (or do a global find-replace across both `.tsx` and `.css` simultaneously)
2. Change CSS variable values first — instant visual changes, zero breakage risk
3. Change layout structure (grid → flex, etc.) within existing class selectors
4. Extract any new sub-components but keep the same root class names on their outermost elements
5. If renaming classes: use `grep -r "class-name" components/ app/ lib/` before every rename to find all TypeScript references
6. The phone mockup (`.property-card-stage` through `.phone-actions`) is entirely self-contained — safe to redesign wholesale as long as the toggle logic (`mobileCardIndex`) stays
