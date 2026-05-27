# Real Estate Email Agent

An AI-powered Gmail agent for real estate teams. Monitors your inbox, understands what each email is asking for, and sends a personalized reply within seconds — property details with photos, live Zillow search results, lead qualification, showing scheduling, and more.

Built for solo agents and small teams (1-20 agents). Each client gets their own deployed instance.

---

## Screenshots

**Live Zillow search results** — "show me 3-bed homes under $500k in Round Rock":

![Search results with Zillow photos](docs/screenshot-search-results.png)

**Property detail reply** — photo, price, beds/baths/sqft, mortgage rates, Calendly button:

![Property detail reply](docs/screenshot-property-detail.png)

**Seller lead qualification** — asks one question + free home valuation CTA:

![Seller lead reply](docs/screenshot-seller-lead.png)

---

## What it does

| Email type | What happens |
|---|---|
| Single property inquiry | HTML reply with hero photo, price, beds/baths/sqft, mortgage rates, neighborhood stats, Calendly button, and optional similar homes block |
| Multi-property inquiry | Card-per-property reply with photos and details for all addresses |
| Property search (e.g. "3-bed under $500k in Round Rock") | Searches your sheet first, hits live Zillow if sheet has fewer than 3 matches, appends new results to sheet |
| Showing request | Reply with Calendly booking link |
| Buyer lead | Qualifies over up to 3 emails (budget, area, timeline) → HubSpot contact |
| Seller lead | Qualifies + sends free home valuation form link |
| Renter lead | Qualifies → routes to property manager if configured |
| Hot lead detected | Instant SMS to agent via Twilio |
| No reply in 3 days | Automatic day-3 follow-up email |
| No reply in 7 days | Final follow-up, then marked cold |
| Spam / complex | Labeled `NEEDS_HUMAN`, no reply sent |

All replies include a consistent signature and are sent as threaded replies to the original email.

---

## Data sources

| Source | Used for | Cost |
|---|---|---|
| Google Sheet | Your own active listings (primary cache) | Free |
| Zillow via Apify | Live property details + photos for any address | ~$0.002/lookup |
| Zillow search via Apify | Live inventory search by area/beds/price | ~$0.002/result |
| Zillow sold comps via Apify | Max 2 comps, only on explicit price/value questions | ~$0.006/trigger |
| RentCast | Rental value estimates | Free (50 req/month) |
| FRED API | Current 30yr/15yr mortgage rates | Free |
| Census ACS | Neighborhood median income by ZIP | Free |

New properties fetched from Zillow/RentCast are automatically appended to your Google Sheet so future inquiries hit the sheet cache at zero cost.

---

## Setup

### 1. Google Cloud — Gmail + Sheets OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project
2. Enable **Gmail API** and **Google Sheets API**
3. Configure OAuth consent screen → External → add your Gmail as a test user
4. Create **OAuth 2.0 Client ID** → **Desktop app** → Download JSON → save as `credentials.json`
5. Add `http://localhost:8080/` to Authorized redirect URIs

### 2. Google Sheet

Create a sheet with a tab named **`properties`**. Row 1 headers (exact order):

```
address | price | beds | baths | city | state | zip | description | neighborhood | property_type | features | days_on_market | photo_url | sqft | year_built | status | listing_url | agent_name | agent_email
```

Copy the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`

### 3. API keys

| Service | Where to get it | Cost |
|---|---|---|
| Anthropic | [console.anthropic.com](https://console.anthropic.com) | Pay-per-use (~$0.01–0.05/email) |
| Apify | [console.apify.com](https://console.apify.com) → Settings → Integrations | Pay-per-use |
| HubSpot | App → Settings → Integrations → Private Apps | Free tier |
| Twilio | [console.twilio.com](https://console.twilio.com) | ~$0.008/SMS |
| RentCast | [app.rentcast.io](https://app.rentcast.io) | Free (50 req/month) |
| FRED | [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) | Free |
| Census | [api.census.gov/data/key_signup.html](https://api.census.gov/data/key_signup.html) | Free |
| Calendly | [calendly.com](https://calendly.com) | Free tier |

### 4. Install

```bash
git clone https://github.com/Ofunrein/real-estate-email-agent
cd real-estate-email-agent
pip install -r requirements.txt
cp .env.example .env
# Fill in .env with your keys
```

### 5. First run

```bash
python agent.py
```

A browser window opens for Gmail OAuth. Approve access — `token.json` is saved and re-auth is not needed again unless scopes change.

The agent only processes emails that arrive **after** first start. The startup timestamp is saved to `state.json`.

---

## Configuration

All config lives in `.env`. See [`.env.example`](.env.example) for the full reference.

Key variables:

```bash
TEAM_NAME=Austin Realty          # Used in replies and notifications
TEAM_LEAD_EMAIL=                 # Receives lead notifications + fallback routing
AGENT_PHONE=+1xxxxxxxxxx         # SMS destination for hot leads
POLL_INTERVAL_SECONDS=60         # How often to check for new emails
ENABLE_SIMILAR_HOMES=false       # Optional similar-home cards on single-property inquiry emails
```

**Agent routing:** Add `Agent Name` and `Agent Email` columns to your sheet. Inquiries about a specific listing are CC'd to that agent automatically.

---

## Agent Inbox V1

Agent Inbox is a read-only monitor for the shared Google Sheet workbook. It shows lead memory, conversation events, email threads, and basic metrics.

Prepare the workbook:

```bash
python3 scripts/setup_agent_inbox_sheets.py
```

Run the email agent:

```bash
python3 -m channels.iris_email
```

The legacy `python3 agent.py` entry point still works. Disable Iris with `ENABLE_EMAIL_AGENT=false`.

Run the local Python Agent Inbox debug viewer:

```bash
python3 -m agent_inbox.app
```

Open `http://127.0.0.1:8787`.

Run the Next.js Agent Inbox:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

For hosted/multi-client deployment, run the Postgres schema and sync Sheets into the database:

```bash
psql "$DATABASE_URL" -f db/migrations/001_agent_os.sql
npm run sync:sheets
```

See [docs/hosted-client-onboarding.md](/Users/martinofunrein/Downloads/real-estate-email-agent/docs/hosted-client-onboarding.md).

Property hygiene checks:

```bash
python3 scripts/property_hygiene.py
python3 scripts/property_hygiene.py --repair
python3 scripts/property_hygiene.py --enrich --limit 25
```

V1 uses three required tabs in the same Google Sheet workbook:

- `properties`
- `lead_memory`
- `conversation_events`

---

## Gmail labels

| Label | Meaning |
|---|---|
| `AUTO_REPLIED` | Agent replied automatically |
| `NEEDS_HUMAN` | Flagged for manual follow-up (spam, complaints, complex) |

---

## Follow-up sequences

For buyer, seller, and renter leads:

- **Day 3** — Soft check-in referencing their budget/area/timeline
- **Day 7** — Final touch, keeps door open, then marked cold

Tracked per thread in `state.json`. No external scheduler needed.

---

## Logging

Every external API call, Claude invocation, Gmail send, label, and HubSpot action is logged to `agent.log` with timestamps, HTTP status, and elapsed time. Cost is tracked per call and as a running session total.

```
2026-05-18 14:32:01 [INFO] --- Processing message id=... from=buyer@example.com
2026-05-18 14:32:01 [INFO] Intent: property_details | Addresses: ['5005 Buchanan Draw Rd, Austin TX']
2026-05-18 14:32:02 [INFO] Apify maxcopell/zillow-detail-scraper — returned 1 item(s)
2026-05-18 14:32:02 [INFO] COST $0.00200 — apify (maxcopell/zillow-detail-scraper x1) | session total $0.0020
2026-05-18 14:32:03 [INFO] Claude claude-sonnet-4-6 — 890 in / 198 out tokens (1243ms)
2026-05-18 14:32:03 [INFO] COST $0.00564 — claude | session total $0.0076
2026-05-18 14:32:04 [INFO] Gmail send — delivered
2026-05-18 14:32:04 [INFO] Reply sent — to=buyer@example.com intent=property_details
```

---

## Deploy 24/7

**Railway / Render (recommended):**
```
Start command: python agent.py
```

**VPS:**
```bash
nohup python agent.py >> agent.log 2>&1 &
```

**Per-client deployment:** Each client gets their own folder with their own `.env`, `credentials.json`, and `token.json`. One process per client. ~$5/month per instance on Railway.

```
client_folder/
├── agent.py
├── credentials.json
├── token.json        ← generated once locally, then uploaded
├── .env              ← client-specific config
└── state.json        ← auto-generated at runtime
```

---

## Cost estimate

Typical per-email cost for a property inquiry (Apify + Claude):

| Item | Cost |
|---|---|
| Haiku classification | ~$0.0002 |
| Zillow detail lookup | $0.002 |
| Sonnet reply generation | ~$0.005 |
| **Total per email** | **~$0.007** |

A team handling 200 inbound emails/month: ~$1.40/month in AI/scraping costs.

---

## Requirements

- Python 3.10+
- Gmail account with API access
- Google Sheet (read/write)
- Anthropic API key
- Apify token

All other integrations (HubSpot, Twilio, FRED, Census, RentCast) are optional but recommended.
