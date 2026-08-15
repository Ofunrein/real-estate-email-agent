# Production security hardening pass — 2026-08-15

Audit of every live HTTP entrypoint (84 route handlers, middleware, auth) plus a
vibe-coded-app vulnerability checklist (hardcoded secrets, missing CSRF, token
storage, input validation, dead privileged code).

## What was wrong

1. **`proxy.ts` was dead code holding the auth gate.** It exported
   `auth as proxy` with `matcher: ["/"]`. On Next.js 15 the live edge file is
   `middleware.ts`, so the NextAuth `authorized()` callback never ran. Routes
   whose comments claimed "session-protected by middleware" were anonymous:
   `POST /api/voice/call` (outbound dialing), `POST /api/voice/hangup`,
   `GET /api/voice/live` (live transcripts), `GET /api/media/audio` (proxies
   Twilio recordings using our account credentials). Fixed by calling
   `requireDashboardAuth()` in each handler and deleting `proxy.ts` — keeping it
   would have silently replaced `middleware.ts` (losing rate limits and payload
   caps) on a Next 16 upgrade.
2. **`POST /api/webhooks/aria-sms-control` had no authentication at all** and
   trusted the Twilio `From` field to authorize operator commands (pause the
   agent, dial an arbitrary number). Now requires a valid `X-Twilio-Signature`
   (`lib/twilioSignature.ts`) and refuses traffic when unconfigured.
3. **No CSRF protection on any cookie-authenticated mutation.** `middleware.ts`
   now rejects cross-origin mutating `/api` requests via `Sec-Fetch-Site` /
   `Origin` (compared against the forwarded host, not the internal proxy URL).
   Provider callbacks under `/api/webhooks`, `/api/cron`, `/api/inngest` and
   `/api/auth` are exempt — they carry their own secret or signature.
4. **Payload cap was bypassable.** The old check read
   `Number(header ?? 0)`, so a chunked request with no `Content-Length` scored 0
   and passed. Missing/unparseable lengths and `Transfer-Encoding` now get 411.
5. **Rate limiting was process-local.** An in-memory `Map` cannot bound a
   distributed attack across serverless instances. `lib/sharedRateLimit.ts`
   enforces the limit in a shared Upstash Redis store; the in-memory map is now
   labelled as the per-instance fallback only. **Production must set
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`** (or a Vercel Firewall
   rule) — without it the limit is best-effort, not enforced.
6. **`assertWebhookSecret` failed open** when `CHANNEL_WEBHOOK_SECRET` was
   unset, and compared secrets with `!==`. Now fails closed in production and
   compares in constant time; the cron routes use the same comparison.
7. **XSS defence depth.** The server-side email HTML pre-clean missed unclosed
   `<script src=…>`, entity-encoded `javascript:` URLs and script-capable
   containers (`<svg>`, `<base>`, `<math>`). Three components also fell back to
   *unsanitized* HTML whenever `window` was undefined (i.e. during SSR); they
   now render nothing instead. A CSP, HSTS and COOP were added.
8. **`/api/media/proxy` allowlist could be escaped by a redirect** and would
   serve `image/svg+xml` (a script-capable document) from our own origin. The
   final URL is re-validated and SVG responses are refused.

## Known residual risk

- Shared rate-limit store is not provisioned in production yet (env absent).
- Inbound webhooks have no replay protection (Twilio signatures carry no
  timestamp); impact is bounded by idempotency in `providerSendSafety`.
- `CHANNEL_WEBHOOK_SECRET` is still accepted as a `?secret=` query parameter for
  already-configured providers; query secrets land in access logs.
- CSP keeps `'unsafe-inline'` in `script-src` for the theme bootstrap script.
- `lib/workspaceContext.ts` uses `AsyncLocalStorage.enterWith`, which is not
  strictly request-scoped; prefer `runInRequestWorkspace` for new callers.
- A Google API key was committed to this public repo's history inside
  `dataset_zillow-detail-scraper_*.csv` (removed from HEAD in `07f67ec`, still
  reachable from `cdc16ca`). It needs rotation and a history purge — both
  require owner action.
