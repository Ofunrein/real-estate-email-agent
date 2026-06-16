# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Multi-channel real estate AI agent platform. Four named agents share one cross-channel brain:
- **Iris** — email (`agent.py`, Python daemon, Anthropic API)
- **Theo** — SMS/RCS/WhatsApp (`app/api/webhooks/theo-sms/`, `channels/theo*`, Twilio)
- **Aria** — voice (`app/api/webhooks/aria-voice/`, Vapi + GPT-4o-mini)
- **Olivia** — website chat (`app/api/webhooks/olivia-website/`)

Dashboard is a **Next.js 16 + React 19 + TypeScript** read-only inbox at `http://localhost:3000`. Python handles zero UI — it is a background daemon only.

## Commands

```bash
# Dev
npm run dev                  # Next.js on :3000 (falls back to :3001)
npm run build                # TypeScript check + production build
npm run lint                 # ESLint

# Tests
npm test                     # TS tests via node:test + tsx (tests/ts/**/*.test.ts)
npm run test:py              # Python tests via pytest (tests/)
node --import tsx --test tests/ts/someFile.test.ts  # single TS test file

# Agents
npm run aria:provision       # Sync lib/ariaAssistant.ts → Vapi (run after every Aria config change)
npm run aria:test            # Aria voice smoke test
npm run aria:followup        # Cadence follow-up queue (add --live to actually dial)
npm run sync:ghl             # Sync events to GHL (add --live for real)

# Data
npm run import:zillow        # Import Apify Zillow properties to sheet/DB
npm run sync:sheets          # Sheets → Neon DB
npm run setup:neon           # Bootstrap Neon DB from scratch
```

**Testing rule:** TS code → test in TS. Python code → test in Python. No cross-runtime assertions.

## Architecture

### Data layer (dual-mode)

`lib/dataSource.ts` is the single entry point — automatically routes to Neon Postgres (`DATABASE_URL` env set) or Google Sheets fallback. All callers import from `dataSource.ts`, never directly from `database.ts` or `googleSheets.ts`.

Google Sheets tabs: `properties`, `lead_memory`, `conversation_events` (defined in `lib/sheetSchema.ts`). All fields are `SheetRow = Record<string, string>`. **Field names in `lib/sheetSchema.ts` must stay in sync with `sheet_schema.py` in Python** — renaming one without the other silently breaks the dashboard.

### Backend contract (never break)

The `/api/data` route returns `AgentInboxData` (defined in `lib/inboxData.ts`). All top-level keys must be present. The Python agent and TS webhooks write to the same storage using these exact string values:
- `channel` field: `"email"`, `"sms"`, `"rcs"`, `"whatsapp"`, `"voice"`, `"web"`, `"website"`, `"website_chat"`
- `direction` field: `"inbound"` or `"outbound"` (case-sensitive)

### Email agent (Iris)

`agent.py` runs a 60s poll loop: Gmail API → Haiku classify → Sonnet reply → write Sheets + Neon. Classification returns structured lead fields (budget, timeline, area, beds). Compliance flags trigger `NEEDS_HUMAN` Gmail label with no reply. Style training is flag-gated (`ENABLE_STYLE_TRAINING=false` default — off = byte-identical behavior).

### Voice agent (Aria)

Vapi manages the call loop. Tool calls hit `app/api/webhooks/aria-tools/[tool]/route.ts` → `lib/ariaTools.ts`. Data is cache-first with a 3.5s budget; falls back to SMS if Vapi tool call times out. **Source of truth for Aria config is `lib/ariaAssistant.ts`** — run `npm run aria:provision` after every change; do not edit via Vapi dashboard.

Key behavior: `getCallerContext()` returns silently (never triggers "welcome back" speech). `stripStreetSuffix()` handles STT address mishearing (Road/Path/Drive variants).

### SMS agent (Theo)

`lib/theoAgent.ts` orchestrates; `lib/theoData.ts` fetches property data; `lib/theoLlm.ts` generates replies. Webhook at `/api/webhooks/theo-sms`. `isUsableProperty()` in `lib/theoData.ts` (and equivalently `ariaData.ts`) guards against sending junk/incomplete property data.

### Client config

`lib/clientConfig.ts` drives per-client customization: agent names, brand voice, Vapi voice ID, CRM/calendar wiring, cadence pacing, quiet hours. `resolveClientConfig()` is pure/testable; `clientConfig()` reads from `process.env` at runtime.

### Dashboard UI

`components/AgentInboxClient.tsx` is the main client component (~1300 lines). Polls `/api/data` every 5 seconds. Extracted components live in `components/inbox/`. Design system: "Brokerage Terminal" — warm off-white `#F7F5F2`, dark sidebar `#0F1210`, clay accent `#B85C38`. All CSS tokens in `app/globals.css` `:root` — use `var(--)` only, no hardcoded hex in TSX.

### DB migrations

`db/migrations/001_agent_os.sql`, `002_ghl_sync.sql`, `003_voice.sql` — run in order. `CLIENT_ID=austin-realty` is required env for multi-tenant DB queries.

## Vapi config

- Assistant ID: `793aca1d-2842-419f-8e1c-9766a599d098`
- Phone: `+15128469460`
- Model: `gpt-4o-mini`, Voice: `nova`

## Key env vars

`ANTHROPIC_API_KEY`, `DATABASE_URL`, `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, `PUBLIC_BASE_URL`, `HUMAN_TRANSFER_NUMBER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`, `CLIENT_ID`
