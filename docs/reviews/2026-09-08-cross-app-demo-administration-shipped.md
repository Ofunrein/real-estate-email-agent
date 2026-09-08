# Cross-app demo administration — integration shipped

Date: 2026-09-08. Implemented via Apple Orchard Opus 5 (`orchard-claude-opus-5`).

Scope executed: Step 2 of the reviewed plan
(`docs/reviews/2026-09-08-admin-migration-plan-review.md`) — the additive
server-to-server demo-administration API on the public host, matching the client
contract already landed in the primary app, plus the frozen cross-repo contract
vectors on both sides.

Nothing was merged, deployed, applied, or sent.

---

## 1. Deliverable SHAs and PR URLs

| Repo | Branch | PR | Head SHA | CI |
|---|---|---|---|---|
| `Ofunrein/lumenosis-site` | `feature/platform-demos-api` | https://github.com/Ofunrein/lumenosis-site/pull/8 | `ef19007f386ca8501c35802a8fc90b73be4fe240` | Test workflow: success |
| `Ofunrein/real-estate-email-agent` | `feature/admin-command-center` | https://github.com/Ofunrein/real-estate-email-agent/pull/7 | `2ee29d274b2c268822d61681a8ea092c0f476f1a` | Build, Test & Lint Check: success |

Commits added this run:

- `lumenosis-site` `82fef55a5826fd259c07f2a98309e93ff856bb59` — feat: signed platform demo API for the admin app
- `lumenosis-site` `ef19007f386ca8501c35802a8fc90b73be4fe240` — test: freeze the cross-repo signature vectors
- `real-estate-email-agent` `2ee29d274b2c268822d61681a8ea092c0f476f1a` — test: freeze the cross-repo signature vectors

Base state at start: `lumenosis-site` clean on `main` @ `41aedf5`;
`feature/admin-command-center` @ `6e9ef71`. `main` was never edited or pushed in
either repo; all work is on feature branches.

---

## 2. Contract (as implemented, both sides verified)

Direction: primary app (A) → public site (S). S never calls A and never learns
tenant identity.

Signing, keyed on `LUMENOSIS_PLATFORM_API_SECRET` (min 32 chars, independent of
`DEMO_ROOM_SECRET`):

```
scheme    = "lumenosis-platform-v1"
digest    = HMAC_SHA256(scheme,  body_bytes)            hex
payload   = scheme \n METHOD \n PATH \n timestamp \n nonce \n digest
signature = HMAC_SHA256(secret, payload)                hex
```

Headers: `x-lumenosis-timestamp` (unix ms), `x-lumenosis-nonce`,
`x-lumenosis-signature`, `content-type: application/json`.

Endpoints on S (all additive):

- `GET  /api/platform/demos` → `{ demos: [{ id, fullName, businessName, emailDomain, address, status, outreachStatus, subject, demoUrl, createdAt }] }`
- `POST /api/platform/demos/[id]/approve` → `{ ok: true, approved: true }`
- `POST /api/platform/demos/[id]/send` → `{ ok: true, alreadySent }`

Every response carries `Cache-Control: private, no-store`. Unconfigured → `503`.
Auth failure → `401 {"error":"Unauthorized"}` with no reason field.

Security properties implemented in `lib/platform-auth.ts`:

- constant-time signature comparison (`timingSafeEqual`, length-checked first)
- bounded clock skew, ±300 s, enforced in both directions
- single-use nonces within the skew window, with expiry so the store cannot grow
  without bound — best-effort by design, since a serverless instance cannot see a
  sibling's state; the skew bound is the hard limit and this is stated in-code
  rather than overclaimed
- allowlists: methods per route, `application/json` content type on writes,
  `^[A-Za-z0-9-]{8,64}$` id shape, 2048-byte body cap
- signature bound to method, path, and exact body bytes, so a valid signature
  cannot be moved between endpoints
- platform-admin role enforcement stays in the primary app; S grants nothing on
  the caller's claims and authenticates every request independently
- the shared-password admin cookie does not authenticate the platform API
  (asserted by test)

---

## 3. Production / customer-facing files touched

| File | Change | Customer-facing risk |
|---|---|---|
| `app/api/platform/demos/route.ts` | new | none — new path, unauthenticated callers get 401/503 |
| `app/api/platform/demos/[id]/approve/route.ts` | new | none — new path |
| `app/api/platform/demos/[id]/send/route.ts` | new | none — new path; send is idempotent |
| `lib/platform-auth.ts` | new | none — not reachable from any public page |
| `lib/demo-admin-service.ts` | new | extracted from the two existing admin routes; behavior preserved |
| `app/api/admin/demos/[id]/approve/route.ts` | now delegates to the shared service | same auth, same redirect; approve became idempotent rather than silently no-op |
| `app/api/admin/demos/[id]/send/route.ts` | now delegates to the shared service | same auth, same redirect, same 404/503/502 shapes |
| `lib/env.ts`, `.env.example` | one optional var added | none — optional, absent means the API fails closed |
| `db/0002_outreach_idempotency.sql` | new, **not applied** | none — no DB was touched |
| `tests/*.spec.ts` (4 files) | new tests | none |

Not touched, verified by inspection and test: `/demo/[token]`,
`app/api/demo/[token]/{email,event,voice}`, `lib/demo-room.ts`,
`lib/admin-auth.ts`, `content/demo-rooms.ts`, `next.config.ts`, all marketing
pages. No middleware exists or was added.

---

## 4. Old-link and token-semantics preservation

- `demoUrlForToken()` reproduces the existing string exactly:
  `https://lumenosis.com/demo/<token>` — the same host hardcoded at the original
  `generate/route.ts:222`, so already-sent emails keep pointing at a live URL.
  A test asserts the string and asserts it does not contain `trylumenosis`.
- No token is derived, re-derived, re-signed, or rotated anywhere in the new code.
  Tokens are read out of Turso and passed through.
- `DEMO_ROOM_SECRET` is never read by the new modules and was not rotated, so
  static-fallback tokens from `tokenForDemoRoom()` and every live admin cookie
  remain valid.
- Zero redirects, rewrites, or middleware added. A test asserts `/demo/<token>`
  does not answer 301/302/307/308.
- Route paths, the 43-char base64url token format, and the `token_hash` lookup
  are unchanged; `engagement_events` writes are untouched, so tracking continuity
  holds.

## 5. Compatibility window

`/admin/demos`, `/admin/demos/login`, `/api/admin/login`, and all three
`/api/admin/demos/*` routes remain live and fully operational. The old and new
surfaces now call one shared service (`lib/demo-admin-service.ts`), so their
behavior cannot fork while both exist. `tests/platform-demos-routes.spec.ts`
asserts the login page still returns 200, the old approve route still behaves,
and the platform API rejects the admin cookie.

## 6. Idempotency

- **approve** — the `UPDATE` still matches only `status = 'draft'`, then the row
  is re-read. An already-approved room returns `200 { ok: true, approved: true }`
  instead of an error, so a retry is safe and indistinguishable from the first
  call. A missing or non-approved row returns 404.
- **send** — the draft lookup requires `o.status = 'draft' AND d.status =
  'approved'`. An already-sent draft returns `{ ok: true, alreadySent: true }`
  **without calling AgentMail**. The `UPDATE ... SET status = 'sent'` carries
  `AND status = 'draft'`, and a provider failure returns 502 without marking the
  draft sent — asserted by two separate tests.
- **generate** — deliberately not exposed on the signed API this pass. It
  performs paid outbound research/LLM calls and writes four rows; exposing it
  without a persisted idempotency key would make a retry create a duplicate
  prospect. `db/0002_outreach_idempotency.sql` is the additive, unapplied
  prerequisite; generate stays on the existing shared-password surface, which is
  operational, until that migration is approved and applied.

## 7. PII and logging

The list contract carries `emailDomain`, never the prospect mailbox, and never
`outreach_drafts.body` or `demo_rooms.access_token` as a bare field (the token
appears only inside `demoUrl`, which the admin panel must render). A test asserts
the serialized summary contains no mailbox and no `body`/`access_token` keys.

`grep` over every touched surface (`lib/platform-auth.ts`,
`lib/demo-admin-service.ts`, `app/api/platform/*`, `app/api/admin/*`) confirms
zero `console.*` or logger calls: no bodies, tokens, signatures, secrets, or
prospect data are logged. Auth failure reasons are computed for control flow and
never returned or recorded.

## 8. Migration status

`db/0002_outreach_idempotency.sql` — additive only: one nullable column plus a
partial unique index, no rewrite, no drop, no down-migration needed.
**Not applied.** No database was contacted during this run. Leaving it unapplied
is safe because the send path is already idempotent via the `status = 'draft'`
guard.

No Turso data was migrated. Demo and prospect data stay in Turso; nothing moved
to Postgres or Neon, and the admin app holds no Turso credentials.

## 9. Gauntlet loop (bounded, 2 of 3 rounds used)

Round 1 — `lumenosis-site`:
`tsc -p tsconfig.json --noEmit` clean; `pnpm test` (Next production build +
Playwright) **47/47 passed**; `biome check` clean on touched files after fixes.
Biome's write pass had also reformatted four unrelated files
(`app/api/lead/route.ts`, `app/api/inbox-audit/route.ts`,
`app/api/tiktok/callback/route.ts`, `app/team/page.tsx`); those were reverted so
the diff carries no unrelated churn.

Round 2 — both repos, after adding the frozen vectors:
`lumenosis-site` `tsc --noEmit` clean, `pnpm test` **50/50 passed**, biome clean.
`real-estate-email-agent` `npm run security:scan` passed (838 tracked files),
`npm run lint` (tsc) clean, `npm test` **989/989 passed** (985 → 989 with the new
vectors).

Cross-repo parity proof: the primary app's real `signedHeaders()` was executed
against the site's real `verifyPlatformRequest()` in one process. All three
endpoints verified; tampered path, wrong secret, and replayed nonce were all
rejected. Round 3 was not needed.

CI: both PR head SHAs are green — site PR #8 "Test" workflow success on
`ef19007`, primary PR #7 "Build, Test & Lint Check" success on `2ee29d2`.

## 10. Deployment

No deployment was performed. Deploy order is strictly S-before-A: PR #8
(producer) merges and deploys before the admin panel in PR #7 is pointed at it.
Until `LUMENOSIS_PLATFORM_API_URL` and `LUMENOSIS_PLATFORM_API_SECRET` are set,
the admin panel stays in its `not_configured` state and the API fails closed with
503 — no half-configured window exists.

Env to set on both sides at deploy time: `LUMENOSIS_PLATFORM_API_SECRET`
(identical value, min 32 chars, newly generated — do not reuse
`DEMO_ROOM_SECRET`), plus `LUMENOSIS_PLATFORM_API_URL=https://lumenosis.com` on
the admin app only.

## 11. Contraction — deferred, not in scope

Unchanged from the reviewed plan §5. Only after the compatibility window runs in
production: delete `lib/admin-auth.ts`, `app/admin/demos/*`, `app/api/admin/*`;
rotate `LUMENOSIS_ADMIN_PASSWORD`; drop the dual nav path in the admin app.
`DEMO_ROOM_SECRET` rotation still requires a token-migration design first,
because it invalidates static-fallback demo tokens. Nothing in this change makes
contraction harder: rollback is code-only, since no data moved and no route was
removed.

## 12. Remaining blockers, unchanged by this work

- **B1** — resolved in the only way that is safe without a live DNS check: the
  new code reproduces the already-sent `lumenosis.com` string verbatim rather
  than picking a host. If `lumenosis.com/demo/*` is ever proven to redirect, that
  is a pre-existing condition of already-sent links, not something introduced
  here.
- **B3** — the additive idempotency migration is written but unapplied; signed
  `generate` waits on it.
- **B4** — `feature/iris-dashboard-redesign` still conflicts with Step 1 at
  `IrisDashboard.tsx:236-246`. Untouched this run.
