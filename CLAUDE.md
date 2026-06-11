# Lumenosis Real-Estate Agent OS — CLAUDE.md

## What this is
Multi-channel real-estate AI agent platform. Four agents sharing one cross-channel brain:
- **Iris** — email (`agent.py`, Python, Anthropic)
- **Theo** — SMS/WhatsApp (`app/api/webhooks/theo-sms/route.ts`, TS)
- **Aria** — voice (`app/api/webhooks/aria-voice/`, TS, Vapi)
- **Olivia** — website chat (`app/api/webhooks/olivia-website/`, TS)

Active branch: `feature/aria-voice-agent`

## Vapi (voice agent)
- Assistant ID: `793aca1d-2842-419f-8e1c-9766a599d098`
- Phone: `+15128469460`
- Model: `gpt-5-mini` (OpenAI), Voice: `nova` (OpenAI TTS)
- **Source of truth for assistant config:** `lib/ariaAssistant.ts`
- **To update Vapi:** `npm run aria:provision` — do NOT patch via inline fetch, do NOT use dashboard for structural changes

## Key commands
```bash
npm test                    # 104 TS tests
npm run test:py             # 76 Python tests (pytest)
npm run aria:test           # Aria smoke test
npm run aria:provision      # Sync lib/ariaAssistant.ts → Vapi
npm run aria:followup       # Cadence queue (--live to actually dial)
npm run sync:ghl            # Sync events to GHL (--live for real)
```

## Dev + tunnel
```bash
npm run dev                 # starts on :3000 (or :3001 if occupied)
cloudflared tunnel --url http://localhost:3001 --protocol http2
# Tunnel URL changes every restart — re-run aria:provision after restart
```

## DB
- Neon Postgres. `DATABASE_URL` in `.env`. `CLIENT_ID=austin-realty`.
- Migrations: `db/migrations/001_agent_os.sql`, `002_ghl_sync.sql`, `003_voice.sql`
- Run `npm run setup:neon` to bootstrap a fresh DB.

## Critical rules
- **Always run `npm run aria:provision` after changing `lib/ariaAssistant.ts`**
- **Never cache or SMS junk property data** — `isUsableProperty()` guard in `ariaData.ts`
- **STT address matching** — `stripStreetSuffix()` handles Road/Path/Drive mishearing
- **getCallerContext** returns structured context silently — never triggers "welcome back"
- **Iris style training** is flag-gated (`ENABLE_STYLE_TRAINING=false` default) — flag off = byte-identical behavior

## Testing rule
TS code → test in TS (`node:test` via tsx). Python code → test in Python (pytest). Never use Python tests to assert TS runtime behavior.

## Architecture
```
Vapi (voice loop) → /api/webhooks/aria-tools/[tool] → lib/ariaTools.ts
                                                     → lib/ariaData.ts (cache-first, 3.5s budget, SMS fallback)
                                                     → lib/crm/ghl.ts (appointments, contacts)
                                                     → lib/calendar.ts (book/cancel/reschedule)
Shared: lib/identity.ts, lib/cadence.ts, lib/notify.ts, lib/clientConfig.ts, lib/styleTraining.ts
```

## Key env vars
`VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, `PUBLIC_BASE_URL`,
`HUMAN_TRANSFER_NUMBER=+15128152032`, `ANTHROPIC_API_KEY`, `DATABASE_URL`,
`GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
