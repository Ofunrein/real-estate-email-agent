# Hosted Client Onboarding

## Hosted Architecture

Lumenosis can host this as a multi-client Agentic OS.

Recommended hosted layout:

- Next.js Agent Inbox on Vercel or Render.
- Postgres/Supabase as the operational database.
- Google Sheets as the client-editable workbook.
- Gmail OAuth per client inbox.
- Twilio per client number or messaging service for Theo SMS.
- Vapi/Twilio Voice per client number for Aria voice.
- Background sync jobs for Sheets to database.

Sheets should not be the live dashboard backend once multiple clients and channels are active. Sheets remains useful for editable property/config data, but the app should read/write the database first.

## Per-Client Setup

Each client should get:

- `CLIENT_ID`
- `CLIENT_NAME`
- `DATABASE_URL`
- `GOOGLE_SHEET_ID`
- Gmail OAuth token for the inbox Iris monitors
- Twilio sender number for Theo if SMS is enabled
- Voice number/provider config for Aria if voice is enabled
- Feature flags:
  - `ENABLE_EMAIL_AGENT`
  - `ENABLE_SMS_AGENT`
  - `ENABLE_WHATSAPP_AGENT`
  - `ENABLE_VOICE_AGENT`
  - `ENABLE_WEBSITE_CHAT_AGENT`

## Database

Run:

```bash
psql "$DATABASE_URL" -f db/migrations/001_agent_os.sql
```

Sync Sheets into the database:

```bash
npm run sync:sheets
```

The dashboard uses the database when `DATABASE_URL` is set. If no database is configured, it falls back to Google Sheets.

## Email Connection

For hosted onboarding, the client should connect Gmail or Google Workspace through OAuth. Do not ask for raw passwords.

Iris needs scoped access to:

- read inbound lead emails
- send replies
- label messages
- read thread context

Recommended operational model:

- One connected lead inbox per client, such as `leads@clientdomain.com`.
- Optional connected user inboxes later.
- Store OAuth tokens encrypted.
- Log only message IDs, summaries, extracted fields, and approved excerpts.

## Email Style Learning

Do not fine-tune on a client's private inbox by default.

V1 should use retrieval-style learning:

- Pull a limited sample of sent emails after explicit client approval.
- Redact personal/private details.
- Extract style patterns:
  - greeting style
  - sentence length
  - directness
  - sign-off pattern
  - common phrasing
  - escalation tone
- Store approved examples in `email_style_examples`.
- Use those examples as context for Iris replies.

This gives the agent the client's voice without permanently training a model on private email data.

## Theo SMS Number

Theo requires a real sender number.

Minimum setup:

- Twilio account
- Twilio phone number or messaging service
- inbound webhook endpoint
- outbound send permission
- opt-out handling for `STOP`, `START`, and `HELP`
- lead memory matching by phone number first

Theo should write every inbound and outbound message to `conversation_events` and update `lead_memory`.

## Scaling Rule

Use this split:

- Database: operational truth for agents and dashboard.
- Sheets: editable client knowledge/config layer.
- CRM: client-owned business system.
- Agent Inbox: read-only monitor and troubleshooting view.

This keeps onboarding simple while avoiding Google Sheets quota limits as traffic grows.
