# Enhanced Real Estate Email Agent — Design Spec
**Date:** 2026-05-18
**File:** `agent.py` (single file, all logic)

## Overview

A Gmail-based AI email agent for real estate teams of 1–20 agents. Operator (Martin) manages infrastructure. Each client (agent/team) gets their own deployed instance. Agent handles buyers, sellers, renters, and showing requests for any property nationwide using live Apify/Zillow scraping — no static property database required. Client's own listings are stored in a Google Sheet.

---

## Architecture

```
Gmail inbox (one per client instance)
         ↓
Poll every 60s — max 10 emails per cycle
         ↓
Self-reply guard (skip own emails)
         ↓
Claude Haiku — cheap classification
         ↓
Data Layer (in priority order):
  1. Client's Google Sheet (own active listings)
  2. Zillow via Apify — any property nationwide ($0.002/lookup)
  3. Redfin via Apify — sold comps ($0.002/lookup)
  4. RentCast — rental estimates (free 50/mo)
  5. Census ACS API — neighborhood demographics (free)
  6. FRED API — current mortgage rates (free)
         ↓
Claude Sonnet — full reply generation
         ↓
Send reply (threaded, In-Reply-To + References set)
         ↓
Route lead to assigned agent (or team lead)
         ↓
Push lead to HubSpot CRM (free tier)
         ↓
Apply Gmail label: AUTO_REPLIED or NEEDS_HUMAN
```

---

## Intent Categories (6)

| Intent | Action |
|---|---|
| `property_details` | Look up property (Sheet → Apify), reply with details + Calendly |
| `property_search` | Search Sheet + Zillow by criteria, reply with matches |
| `showing_request` | Reply with Calendly link, notify assigned agent |
| `seller_lead` | Qualify (timeline, motivation, address), push to HubSpot |
| `buyer_lead` | Qualify (budget, area, pre-approval), push to HubSpot |
| `renter_lead` | Qualify (budget, area, move-in date), push to HubSpot |
| `general_question` | Answer from FAQ knowledge base |
| `human_required` | Apply NEEDS_HUMAN label, no reply sent |
| `spam` | Apply NEEDS_HUMAN label, no reply sent |

---

## Data Layer — Free Sources

| Source | Use | Cost |
|---|---|---|
| Google Sheet | Client's own active listings | Free |
| Zillow via Apify (`maxcopell/zillow-detail-scraper`) | Any property details, photos, price | $0.002/lookup |
| Redfin via Apify | Sold comps for CMA | $0.002/lookup |
| RentCast API | Rental value estimates | Free 50/mo |
| Census ACS API | Neighborhood income, demographics | Free |
| FRED API | Current 30yr/15yr mortgage rates | Free |

---

## Lead Routing

- Property has `Agent Email` column in Sheet → route to that agent
- No matched listing → route to `TEAM_LEAD_EMAIL`
- Rental inquiry → route to `PROPERTY_MANAGER_EMAIL` if set
- Buyer with no pre-approval → ask about pre-approval + offer lender referral

Routing = CC the agent on the reply + send them a separate notification email summary.

---

## HubSpot CRM Sync (free tier)

Every non-spam, non-human-required email creates/updates a HubSpot contact:
- Email, name (parsed from From header)
- Intent, budget, timeline, area
- Assigned agent
- Lead score: `hot` (timeline <30 days) / `warm` (1-3 months) / `cold` (exploring)
- Full email thread as a HubSpot note
- Uses HubSpot Contacts API v3 (free, no limit on contacts)

---

## Per-Client Config (.env)

```
GMAIL_CREDENTIALS_PATH=credentials.json
GMAIL_TOKEN_PATH=token.json
GOOGLE_SHEET_ID=
ANTHROPIC_API_KEY=
APIFY_TOKEN=
RENTCAST_API_KEY=
CALENDLY_URL=
TEAM_NAME=
TEAM_LEAD_EMAIL=
PROPERTY_MANAGER_EMAIL=
HUBSPOT_API_KEY=
POLL_INTERVAL_SECONDS=60
```

---

## Claude Models

- **Classification:** `claude-haiku-4-5` (cheap, fast)
- **Response generation:** `claude-sonnet-4-6` (quality)
- **Max tokens:** 512 (keeps replies concise)

---

## Reply Rules (enforced via prompt)

- No emojis
- No em-dashes
- No bullet lists in property replies
- No markdown code fences
- Under 150 words for property replies
- Plain HTML paragraphs only

---

## Knowledge Base

Baked directly into `agent.py` as `FAQ_CONTENT` string — no file dependency. Updated per client by editing their `.env`-adjacent config or by making `FAQ_CONTENT` loadable from an optional `FAQ.md` file if present.

---

## Deployment (per client)

```
client_folder/
├── agent.py        ← shared, same code
├── credentials.json
├── token.json      ← generated once locally
├── .env            ← client-specific config
└── state.json      ← auto-generated at runtime
```

One process per client. Run on Railway/Render at ~$5/month per instance.

---

## What's NOT in scope

- Wholesaling / investor data (excluded per design decision)
- MLS direct integration (requires membership)
- Multi-inbox within one instance (one inbox per process)
- SMS/Twilio (future phase)
- Follow-up sequences (future phase)
- Dashboard UI (future phase)
