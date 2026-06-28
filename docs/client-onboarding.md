# Client Onboarding Guide

New client → live in under 30 minutes.

## Prerequisites

- Neon Postgres project (run `npm run setup:neon` once)
- Vapi account with a phone number
- Twilio account with a number
- Google Calendar access for the agent's inbox (or GHL/Outlook)

---

## Step 1 — Fill the config

```bash
cp clients/template.env clients/new-client-id.env
```

Open `clients/new-client-id.env` and fill every required field:

| Section | Required keys |
|---|---|
| Identity | `CLIENT_ID`, `CLIENT_NAME`, `HUMAN_TRANSFER_NUMBER` |
| Vapi | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` |
| Calendar | `CALENDAR_PROVIDER`, credentials for chosen provider |
| CRM | `CRM_PROVIDER`, credentials for chosen CRM |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |
| Database | `DATABASE_URL` |
| Deployment | `PUBLIC_BASE_URL`, `CHANNEL_WEBHOOK_SECRET` |

Leave `VAPI_ASSISTANT_ID` empty — provision creates it.

---

## Step 2 — Set up Google Calendar (if CALENDAR_PROVIDER=google)

```bash
# Copy client env temporarily to .env or export vars, then:
npm run setup:google-calendar
```

Sign in as the agent's Google account. Copy the printed `GOOGLE_REFRESH_TOKEN` back into the client env file.

---

## Step 3 — Provision Iris to Vapi

```bash
# Load the client env
set -a && source clients/new-client-id.env && set +a

# Dry-run first — prints the assistant JSON, no network calls
npm run aria:provision:dry

# If it looks right, provision live
npm run aria:provision
```

Copy the printed assistant ID and add it to the client env:
```
VAPI_ASSISTANT_ID=<printed-id>
```

---

## Step 4 — Verify live assistant

```bash
npm run aria:verify
```

All required tools should show as attached. Fix any missing ones by re-provisioning.

---

## Step 5 — Test call

```bash
# Outbound test call to agent's number
node scripts/test-call.mjs +1XXXXXXXXXX
```

Call inbound to the Vapi phone number and verify:
- Iris answers with the correct company name
- `getCallerContext` fires and returns "New caller" or known context
- Ask to check availability — slots should return from Google Calendar
- Ask to book — confirm booking appears in Google Calendar + Neon DB

---

## Step 6 — Deploy to Vercel

```bash
# Add all client env vars to Vercel
vercel env add CLIENT_ID
vercel env add VAPI_API_KEY
vercel env add GOOGLE_REFRESH_TOKEN
# ... (or use Vercel dashboard to bulk-add from the .env file)

vercel --prod
```

Point Vapi's assistant server URL to the deployed webhook:
```
https://app.clientdomain.com/api/webhooks/aria-voice?secret=YOUR_SECRET
```

This is set automatically by `aria:provision` when `PUBLIC_BASE_URL` is in env.

---

## Calendar provider quick-reference

| Provider | What to set | Best for |
|---|---|---|
| `google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` | Default — works with any Google Calendar |
| `outlook` | `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT_ID`, `OUTLOOK_REFRESH_TOKEN` | Microsoft 365 / Outlook users |
| `ghl` | `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`, `GHL_CALENDAR_ID` | Clients already on GoHighLevel |
| `neon` | Nothing extra — uses internal Postgres | Dev/staging only |

---

## CRM provider quick-reference

| Provider | What to set | Best for |
|---|---|---|
| `ghl` | `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID` | GoHighLevel clients |
| `kvcore` | `KVCORE_API_KEY` | KvCORE / Lofty clients |
| `fub` | `FUB_API_KEY` | Follow Up Boss clients |
| `none` | Nothing | Calendar-only, no CRM sync |

---

## Troubleshooting

**Iris says "I can't check the calendar right now"**
→ Calendar provider not configured or refresh token expired. Re-run `npm run setup:google-calendar`.

**Tool calls timing out**
→ Check `PUBLIC_BASE_URL` is set correctly. Vapi can't reach your webhook.

**Bookings not appearing in GHL**
→ Confirm `GHL_SYNC_MODE=live` (not `dry-run`) and `GHL_CALENDAR_ID` is set.

**Name saved wrong**
→ Iris asks for confirmation before saving. If STT mishears: caller corrects it, Iris re-calls `qualifyLead` with corrected name.
