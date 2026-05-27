# Agent Inbox Buildout Task

Status: complete

## Scope

- Build repeatable property hygiene checks and enrichment tooling.
- Build the Next.js 16 Agent Inbox monitor.
- Add dashboard API routes for sheet-backed data.
- Split Iris email into a channel/personality entry point without breaking the legacy agent.

## Completed

- Added `scripts/property_hygiene.py` for repair, validation, duplicate reporting, and optional live enrichment.
- Added property hygiene unit coverage.
- Added Next.js 16 app shell with Overview, Properties, Email, SMS, WhatsApp, and Voice tabs.
- Added read-only conversation thread UI backed by `conversation_events`.
- Added lead memory side panel backed by `lead_memory`.
- Added API routes:
  - `/api/data`
  - `/api/leads`
  - `/api/conversations`
  - `/api/properties`
  - `/api/metrics`
- Added batched Google Sheets reads and a 30-second cache to avoid read-quota churn.
- Added graceful Sheets error state for the dashboard and API.
- Added Iris channel wrapper at `channels/iris_email.py`.
- Added Iris personality metadata at `personalities/iris.py`.
- Added `ENABLE_EMAIL_AGENT=false` disable path.

## Verification

- `python3 -m unittest discover -s tests`
- `python3 scripts/property_hygiene.py`
- `npm run build`
- Browser smoke check at `http://127.0.0.1:3000`
- Mobile viewport check at `390x844`
- API smoke checks for `/api/metrics`, `/api/properties`, and `/`

## Current Data Health

- Properties: 199
- Schema issues: 0
- Missing operational-field rows: 91
- Duplicate address groups: 1
