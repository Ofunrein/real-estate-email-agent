# Developer Setup

Clean-clone to a running dashboard with **no third-party credentials**. Every command and expected output below was run against this repo.

For how the system works once it is running, read [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Prerequisites

| Tool | Version | Why | Check |
|---|---|---|---|
| Node.js | **22 LTS** (CI pins 22) | App runtime, TS tests | `node -v` |
| npm | 10+ | Ships with Node 22 | `npm -v` |
| Python | **3.12+** (CI pins 3.12) | Contract tests, secret scan | `python3 -V` |
| `psql` | 14+ client | Applying migrations | `psql --version` |
| Postgres + **pgvector** | 16/17 local, or Neon | Storage; migration 023 needs the `vector` extension | see [step 3](#3-stand-up-a-database) |

Verified on Node v22.22.3, npm 10.9.8, Python 3.13.1, PostgreSQL 17 + pgvector 0.8.6.

macOS:

```bash
brew install node@22 postgresql@17 pgvector
```

`.npmrc` forces the public npm registry. Do not remove it — internal-mirror URLs in `package-lock.json` break Vercel installs, and CI fails the build if any appear.

---

## 1. Clone and install

```bash
git clone https://github.com/Ofunrein/real-estate-email-agent.git
cd real-estate-email-agent
npm ci
```

`npm ci` (not `npm install`) to respect the lockfile. A `postinstall` hook rewrites any internal-registry URLs in the lockfile back to `registry.npmjs.org`.

---

## 2. Create your env file

```bash
cp .env.example .env
```

`.env.example` is the tracked template — 262 lines, every key grouped and commented, **all values blank**. `.env` is gitignored. `clients/template.env` is the per-client onboarding template.

Safe-env rules:

- Never commit `.env`, `credentials.json`, or `token.json` — all three are gitignored.
- `npm run security:scan` runs automatically in `prebuild`, so a build fails if a credential is ever committed. Run it directly any time: `npm run security:scan`.
- Non-secret client flags (`CLIENT_ID=austin-realty`) are fine to share. API keys, tokens, and connection strings are not.
- Leave a key blank rather than inventing a placeholder that looks live. The code treats blank as "feature off".

**Minimum to boot locally** (put these in `.env`):

```bash
CLIENT_ID=austin-realty
CLIENT_NAME="Austin Realty"
TEAM_NAME="Austin Realty"
EMAIL_ACCOUNT_CLIENT_ID=austin-realty
PUBLIC_BASE_URL=http://127.0.0.1:3000
AUTH_URL=http://127.0.0.1:3000
ALLOW_LOCAL_AUTH_BYPASS=1
DATABASE_URL=postgres://<you>@127.0.0.1:5432/agent_os_dev
DATABASE_SSL=false
```

`ALLOW_LOCAL_AUTH_BYPASS=1` is what lets you see the dashboard without Google OAuth. It is hard-gated to `NODE_ENV !== "production"` and cannot fire on a production deploy.

Nothing else is required to boot. Leave `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, Twilio, Meta, Vapi, and GHL blank until you need those features — each degrades to off.

---

## 3. Stand up a database

`DATABASE_URL` drives the whole data layer: set it and the app uses Neon/Postgres, leave it blank and the app falls back to Google Sheets, which needs `credentials.json` + `token.json` and **will 503 without them**. For local development, use Postgres.

### Option A — local Postgres (no credentials needed, recommended)

```bash
brew services start postgresql@17
createdb agent_os_dev
psql -d agent_os_dev -c "create extension if not exists vector;"

for m in db/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -d agent_os_dev -f "$m"
done
```

Expected: 26 migrations apply in filename order with no errors, creating **59 tables**. Verify:

```bash
psql -tA -d agent_os_dev -c \
  "select count(*) from information_schema.tables where table_schema='public';"
# 59
```

Then set `DATABASE_URL=postgres://<you>@127.0.0.1:5432/agent_os_dev` and `DATABASE_SSL=false`.

Docker alternative if you would rather not install pgvector:

```bash
docker run -d --name iris-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=agent_os_dev \
  pgvector/pgvector:pg17
# DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agent_os_dev
```

### Option B — Neon (what production uses)

`npm run setup:neon` provisions a project, writes `DATABASE_URL` into `.env`, applies every migration, and runs a Sheets sync. It requires `NEON_API_KEY`, plus `neonctl`, `jq`, and `psql`. Neon ships pgvector, so no extension install is needed. Keep `DATABASE_SSL=true` for Neon.

---

## 4. Run the app

```bash
npm run dev
```

Expected:

```text
▲ Next.js 15.5.23
- Local:        http://localhost:3000
✓ Ready in 5.3s
```

Port 3000, falling back to 3001 if taken; override with `PORT=3005 npm run dev`.

---

## 5. Verify the install

Every command below was run against this repo; the outputs are real.

### 5.1 Static checks and tests

```bash
npm run lint          # tsc over the project. Exit 0, no output on success.
npm test              # → # pass 510   # fail 0
npm run test:py       # → 93 passed
npm run proof         # → {"ok": true, "total": 8, "failed": 0}
npm run security:scan # → Secret scan passed: 644 tracked files checked (count grows with the repo)
npm run build         # prebuild (scan + lint) then next build; prints the route table
```

`npm run proof` replays 8 real email scenarios through the live classifier and reply renderer and rewrites [`proof/iris-email-scenarios.md`](proof/iris-email-scenarios.md). It is offline and deterministic — no network, no keys. CI fails if the committed artifact drifts.

### 5.2 Runtime checks

With `npm run dev` running:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/           # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/data   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/metrics # 200
curl -s http://127.0.0.1:3000/api/data | python3 -c \
  "import json,sys; print(len(json.load(sys.stdin)), 'top-level keys')"   # 14 top-level keys
```

`/api/data` returns the `AgentInboxData` contract — all 14 keys always present, collections empty on a fresh database:

```text
leads, events, voiceCalls, properties, metrics, threads, threadCategories,
inboxCategories, inboxSettings, drafts, emailCapabilities, threadReadStates,
channelAccounts, propertyHealth
```

Security controls should be visible without any auth setup:

```bash
# Security headers on every API response
curl -sD - -o /dev/null http://127.0.0.1:3000/api/data | grep -i "x-frame-options"
# X-Frame-Options: DENY

# Webhooks reject unauthenticated callers
curl -s http://127.0.0.1:3000/api/webhooks/iris-gmail-push
# {"ok":false,"error":"Unauthorized"}   (401)
```

### 5.3 Single test file

```bash
node --import tsx --test tests/ts/irisEmail.test.ts
python3 -m pytest tests/test_sheet_schema.py -v
```

---

## Troubleshooting

**`/api/data` returns 503 `ENOENT: ... credentials.json`**
`DATABASE_URL` is blank, so the app fell back to Google Sheets, which needs `credentials.json` + `token.json`. Set `DATABASE_URL` ([step 3](#3-stand-up-a-database)) — that is the intended local path.

**`extension "vector" is not available` while applying migration 023**
pgvector is not installed for the running Postgres. `brew install pgvector` (then restart Postgres), or use the `pgvector/pgvector:pg17` Docker image. Neon has it built in.

**Dashboard bounces to `/login`, or dashboard APIs return 401**
`ALLOW_LOCAL_AUTH_BYPASS=1` is missing from `.env`. Without it, `requireDashboardAuth()` wants a real allowlisted Google session.

**`429 Too many requests` while testing locally**
Middleware rate limits: 120 requests/min per IP per path, 5 auth attempts/15 min. Wait for the window, or check `Retry-After` / `X-RateLimit-Reset` on the response.

**`403 Cross-origin request rejected` on a POST**
CSRF protection compares `Sec-Fetch-Site`/`Origin` against the forwarded host and the allowlist. Add your origin to `ALLOWED_ORIGINS`, or set `PUBLIC_BASE_URL`/`AUTH_URL` to match how you address the app. Webhook, cron, inngest, and auth paths are exempt.

**`411` on a POST with a body**
`Content-Length` was missing or the body was chunked, so the size cap could not be enforced. Send a fixed-length body. Cap is 1 MB, or 15 MB on the four media upload routes.

**`/api/inngest` returns 503 `INNGEST_SIGNING_KEY is required`**
Expected in production without the key. Locally it returns 401/registers fine; set `INNGEST_SIGNING_KEY` only when wiring real Inngest Cloud.

**Iris processes nothing after a Gmail push**
Check, in order: `IRIS_EMAIL_LIVE`, `IRIS_EMAIL_SEND_REPLIES`, and the per-tenant auto-send setting. All three must be on to actually send — the default posture is draft-only. Then look at `request_audit_events` for the stage that returned `skipped` or `blocked`.

**Gmail history fallback / `history_id_too_old` in audit metadata**
Normal. The stored cursor aged out; the worker scans the unread inbox instead and self-heals after a push or two. See [`ARCHITECTURE.md`](ARCHITECTURE.md#22-history-targeting-and-why-there-is-a-fallback).

**`npm ci` writes internal registry URLs / Vercel install fails with `ENOTFOUND`**
`.npmrc` was bypassed. The `postinstall` hook scrubs the lockfile, and CI fails the build if any internal URL survives.

**Python tests fail to collect with `No module named 'agent'`**
`conftest.py` puts `deprecated/` on `sys.path` for collection. Run pytest from the repo root so that root `conftest.py` is picked up.

---

## Cleanup

```bash
psql -c "drop database agent_os_dev"
brew services stop postgresql@17
# or: docker rm -f iris-pg
```

---

## What to read next

| Goal | Start here |
|---|---|
| Understand the system | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Change email behavior | `lib/irisEmail.ts`, then [`iris-email-stress-workflow.md`](iris-email-stress-workflow.md) |
| Wire a CRM | [`CRM_INTEGRATION.md`](CRM_INTEGRATION.md) |
| Change voice | `lib/ariaAssistant.ts`, then `npm run aria:provision` |
| Add a channel | `lib/channelIngest.ts` + `app/api/webhooks/` |
| Understand a past decision | [`decisions/`](decisions) |
