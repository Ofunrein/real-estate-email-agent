# Google Calendar Setup — Austin Realty (martin@lumenosis.com)

## Status: LIVE

Google Calendar is connected and active. Iris uses it for `checkAvailability` and `bookConsultation` on every call.

---

## How it works

- **Provider**: `CALENDAR_PROVIDER=google` — routes all calendar queries through Google Calendar API
- **Account**: martin@lumenosis.com (Google OAuth, offline access)
- **Auth type**: OAuth2 refresh token (permanent — only revoked if you change your Google password or manually revoke at myaccount.google.com/permissions)
- **No manual re-auth needed** — refresh token auto-exchanges for short-lived access tokens on every API call

---

## What Iris does with it

| Action | Tool | Google Calendar call |
|---|---|---|
| Check open slots | `checkAvailability` | `freebusy.query` — finds busy blocks, generates open 30-min slots |
| Book appointment | `bookConsultation` | `events.insert` — creates confirmed event, emails attendee |
| Cancel | `cancelAppointment` | `events.delete` |
| Reschedule | `rescheduleAppointment` | `events.patch` |

---

## Key env vars

```
CALENDAR_PROVIDER=google
GOOGLE_CLIENT_ID=<from Google Cloud Console — Lumenosis App OAuth client>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console — Lumenosis App OAuth client>
GOOGLE_REFRESH_TOKEN=<in .env — do not share>
GOOGLE_CALENDAR_ID=martin@lumenosis.com
GOOGLE_CALENDAR_SLOT_DURATION=30        # appointment length in minutes
GOOGLE_CALENDAR_SLOT_STEP=30            # slot interval
GOOGLE_CALENDAR_MINIMUM_NOTICE_MINUTES=60  # min lead time before a slot is bookable
```

---

## OAuth app: Lumenosis App (Google Cloud)

- **Project**: `lumenosis-app` (ofunrein123@gmail.com owner)
- **Client ID**: `<see Google Cloud Console — Lumenosis App project>`
- **Authorized redirect URI**: `http://localhost:4242/oauth2callback` (for re-auth only)
- **Scopes**: `https://www.googleapis.com/auth/calendar`

---

## Re-connecting for a new client

For each new client with their own Google Calendar:

```bash
# 1. Set their credentials in their .env file
CALENDAR_PROVIDER=google
GOOGLE_CLIENT_ID=<same Lumenosis App client ID>
GOOGLE_CLIENT_SECRET=<same secret>
GOOGLE_CALENDAR_ID=agent@clientdomain.com

# 2. Run the auth flow (one time per client)
cd ~/Downloads/real-estate-email-agent
set -a && source clients/their-client.env && set +a
npm run setup:google-calendar

# 3. Paste the GOOGLE_REFRESH_TOKEN into their .env
# 4. Provision Iris for that client
npm run aria:provision
```

---

## If the token ever stops working

1. Check: `node --input-type=module -e "import {google} from 'googleapis'; const o = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET); o.setCredentials({refresh_token: process.env.GOOGLE_REFRESH_TOKEN}); o.getAccessToken().then(r => console.log(r.token ? 'OK' : 'FAIL')).catch(e => console.error(e.message))"`
2. If `invalid_grant`: re-run `npm run setup:google-calendar` — token was revoked (password change or manual revoke)
3. If `invalid_client`: client secret rotated in Google Cloud Console — update `GOOGLE_CLIENT_SECRET`

---

## Availability slot logic

Iris calls `freebusy.query` to get busy blocks from Google Calendar, then generates open slots:
- Default window: whatever the caller requests (e.g. "tomorrow afternoon" → 12pm–5pm)
- Slot duration: 30 min (configurable via `GOOGLE_CALENDAR_SLOT_DURATION`)
- Minimum notice: 60 min (can't book within the next hour)
- Iris reads back up to 3 options aloud, then lets caller choose
- After confirmation: creates the Google Calendar event + sends SMS confirmation
