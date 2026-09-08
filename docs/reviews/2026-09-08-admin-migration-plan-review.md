# Lumenosis platform-administration migration — hardened executable plan (review output)

Read-only review. No files edited, no commits, pushes, deploys, migrations, sends. This document is the only
file created, inside the `real-estate-email-agent` worktree.

Approved target (restated, treated as fixed):
- `app.lumenosis.com/admin` = platform-admin shell (role `platform_admin` only)
- `app.lumenosis.com/admin/demos` = demo management
- `app.lumenosis.com` (root) = tenant-scoped dashboard, unchanged
- public marketing + `/demo/[token]` stay on the current public host, unchanged
- demo data stays in Turso for this migration
- shared-password admin stays available during the compatibility window
- university stays out of both repos

## 1. Evidence base (verified this pass)

Admin app repo (worktree `atlas/.worktrees/rea-admin-command-center`, branch `feature/admin-command-center` @ `5b3c29a`,
12 commits ahead of local `main`, 0 behind):
- `app/page.tsx` — only app root; `requireCommandCenterViewer()` then `InboxApp`; no `/admin` route exists.
- `lib/authGuard.ts:33-50` — `requireCommandCenterViewer()`; `localAuthBypassEnabled()` branch picks
  `Object.keys(configuredWorkspaces())[0]`, i.e. can yield `platform_admin` in a misconfigured deploy.
- `lib/workspace.ts:1-35,69-80` — `WorkspaceRole`, role defaults to `tenant_user`; `configuredWorkspaces()`
  falls back to a single hardcoded email with **no role** (so fallback is tenant, good).
- `lib/commandCenterAuth.ts:12-22` — `platform_admin` → any/all tenants; `tenant_user` → own id, else 403.
- `app/api/command-center/route.ts` — viewer gate, window allowlist, tenant regex, `private, no-store`, 503 fail-closed.
- `db/migrations/031_admin_command_center.sql`, `032_model_attempt_telemetry.sql` — additive, `if not exists`,
  append-only ledger trigger.
- Existing tests: `tests/ts/commandCenterAuth.test.ts`, `commandCenter.test.ts`, `commandCenterMigration.test.ts`,
  `workspace.test.ts` (952 TS tests / 96 Python tests green at HEAD per `docs/audits/2026-09-model-routing/07-gauntlet-round1-partial.md`).

Public site repo (`projects/lumenosis-site`, `main` @ `41aedf5`, clean):
- `lib/admin-auth.ts` — shared-password HMAC cookie `lumenosis_admin` from `DEMO_ROOM_SECRET`, path `/`.
- `app/admin/demos/page.tsx`, `app/admin/demos/login/page.tsx`, `app/api/admin/login/route.ts`,
  `app/api/admin/demos/generate|[id]/approve|[id]/send/route.ts`.
- `lib/turso.ts` raw HTTP pipeline client; schema `db/0001_demo_rooms.sql`
  (`prospects`, `listings`, `demo_rooms`, `outreach_drafts`, `engagement_events`).
- `lib/demo-room.ts` — token is 43-char base64url, looked up by `token_hash` with `status='approved' OR admin`,
  plus a static `content/demo-rooms.ts` HMAC-token fallback path.
- Prospect runtime APIs: `app/api/demo/[token]/{email,event,voice}/route.ts`.

**Critical old-link fact the prior review missed:** `app/api/admin/demos/generate/route.ts:222` hardcodes
`https://lumenosis.com/demo/${token}` — already-sent emails point at **lumenosis.com**, not `trylumenosis.com`.
Any "public host" statement in the plan must be verified against the host that actually serves `lumenosis.com/demo/*`
today. This is blocker B1.

## 2. Dirty-file classification (worktree)

| Path | Verdict |
|---|---|
| `app/globals.css` (+13 lines, `.command-center-internal-toggle` 44px hit target) | **Valid prior work residue.** Matches the shipped control at `components/command-center/CommandCenterView.tsx:213-222`, which currently has no CSS class rules. Keep. Commit separately as `fix: 44px hit target for internal-traffic toggle` before any admin work. |
| `evals/model-routing/results/2026-09-08T05-00-25-310Z/` (untracked) | **Valid evidence residue.** Sibling `2026-09-07T21-24-02-099Z/` is tracked at HEAD, so tracking is the convention. Commit as evidence only, not with feature code. |
| `docs/audits/2026-09-model-routing/07-gauntlet-round1-partial.md` (untracked) | **Valid, incomplete.** Documents D2 (`lib/agentCostAudit.ts:62` maps three-valued `TheoMetric.status` so `"found"/"no_data"` are recorded as `failed`) as VERIFIED-NOT-FIXED. Commit as-is; D2 is a prerequisite, see §4 step 0. |
| this file | new review artifact, untracked |

No residue is stale or contradicts the approved target. Nothing to discard.

## 3. Critique of the existing plan (docs/lumenosis-admin-information-architecture-review.md §7)

Defects that would break the approved target if executed as written:

1. **Not expand-migrate-verify-contract.** Its step 6 deletes `lib/admin-auth.ts` and `app/admin/demos/*` in the
   same step as auth cutover. That is a contract step fused into a migrate step, and it violates the approved
   compatibility window. Contraction must be a separate, separately-approved change.
2. **Old-link risk unaddressed.** It says nothing about `/demo/[token]`, and rotating `DEMO_ROOM_SECRET` (its step 6)
   **invalidates every static-fallback token** derived by `tokenForDemoRoom()` in `content/demo-rooms.ts`, plus every
   live shared-password admin cookie. Rotation is therefore prohibited inside this migration.
3. **No mixed-version reasoning.** Two independently deployed Next apps will run old and new code simultaneously.
   The plan has no rule for what the new admin may assume about the public app's deployed version.
4. **Step 1 lands a branch carrying a known-bad metric mapping.** D2 distorts an append-only ledger; landing first
   permanently writes wrong rows.
5. **Datastore ambiguity re-opened** (its §8.3) although the approved target fixes Turso. Remove from scope; keep only
   as a post-contraction question.
6. **Cross-repo API direction unspecified.** Reading Turso from the admin app can be done two ways (direct libSQL
   credentials vs HTTP to the public app). The plan implies "read via a server module mirroring commandCenterStore",
   i.e. direct DB credentials in the admin app. That doubles the blast radius of the Turso token and duplicates
   `lib/demo-room.ts` invariants. Prefer an authenticated HTTP contract (§5).
7. **`localAuthBypassEnabled()` gap noted but never scheduled.** It is the single largest auth-boundary risk once
   `/admin` becomes a URL. Must be a gate, not a note.
8. **No rollback, no idempotency, no PII handling, no PR topology.** Absent entirely.
9. **Conflict with `feature/iris-dashboard-redesign`** (its §8.6) is real: both edit `IrisDashboard.tsx:236-246`.
   Must be resolved by ordering, decided by the user (blocker B4).
10. **Its step 7** (move `inbox-audit` / `preview/*` off the public host) is a *contraction* of public routes and is
    outside the approved target. Exclude.

## 4. Executable plan

Ownership legend: **A** = `real-estate-email-agent` (admin app, Postgres, `app.lumenosis.com`).
**S** = `lumenosis-site` (public host, Turso).

### Step 0 — A: stabilize the branch (no new surface)
- Commit residue as three separate commits: globals.css fix; eval evidence; gauntlet doc.
- Fix D2 in `lib/agentCostAudit.ts`: treat only `{failed,error,timeout,rejected}` as `failed`; everything else
  `succeeded`. Update `tests/ts/commandCenter.test.ts`, `usageLedger.test.ts`, `theoAgent.test.ts`.
- Gate G0: `npm test`, `npm run test:py`, `npm run lint`, `npm run build`, `npm run security:scan`,
  `npm run eval:routing -- --offline` all green.
- PR: `feature/admin-command-center` → `main` (PR #7). Merge is a user action, not an agent action.

### Step 1 — A: expand — `/admin` shell, additive
- New: `app/admin/layout.tsx`, `app/admin/page.tsx`, `lib/adminGuard.ts` (`requirePlatformAdmin()` =
  `requireCommandCenterViewer()` + `viewer.role === "platform_admin"`, else `redirect("/")` for signed-in
  tenants and `redirect("/login")` for anonymous — never 404-leak role existence).
- `lib/authGuard.ts`: `localAuthBypassEnabled()` must additionally require `NODE_ENV !== "production"`
  **and** never resolve a `platform_admin` viewer; bypass returns a forced `tenant_user`.
- Nav: `components/iris-dashboard/IrisDashboard.tsx` "Command center" item becomes a link to `/admin` for
  `platform_admin`; the existing in-page view stays rendered for one release (dual-path = expand).
- Owner: A only. No S changes. No behavior change for `tenant_user`.
- Gates G1: new `tests/ts/adminGuard.test.ts` (matrix: anonymous, `tenant_user`, `platform_admin`, bypass-in-prod,
  bypass-with-admin-first-in-map); existing suites unchanged and green; build green.

### Step 2 — S: expand — read+write API for demo management, additive
Add, do not move or delete:
- `app/api/platform/demos/route.ts` — `GET` list.
- `app/api/platform/demos/[id]/approve/route.ts` — `POST`.
- `app/api/platform/demos/[id]/send/route.ts` — `POST`.
- `app/api/platform/demos/generate/route.ts` — `POST`.
- `lib/platform-auth.ts` — service authentication (§5), independent of `lib/admin-auth.ts`.
Existing `/api/admin/*` and `/admin/demos` remain byte-identical and functional (compatibility window).
Refactor rule: extract the Turso queries and AgentMail send from the existing route handlers into
`lib/demo-admin-service.ts` and have **both** old and new routes call it, so behavior cannot fork.
Gates G2: first tests in this repo — `tests/platform-demos-auth.test.ts` (401 without header, 401 wrong signature,
401 replayed nonce, 200 valid), plus a test asserting `/api/admin/*` still returns its current shapes.

### Step 3 — A: migrate — admin demos panel
- New: `app/admin/demos/page.tsx`, `components/admin-demos/*`, `lib/demoAdminClient.ts` (server-only HTTP client
  to S, base URL from `LUMENOSIS_PUBLIC_APP_URL`, 5s timeout, no retry on non-idempotent POSTs, fail-closed 503
  with a generic message; internals only to `captureServerException`).
- No Turso credentials in A. No demo tables in Postgres. No migration files in this step.
- PII: `prospects.email`, `full_name`, and `outreach_drafts.body` are never logged, never sent to PostHog
  (`lib/productAnalytics.ts` allowlist already forbids), never placed in URLs or `metadata`. `access_token`
  must never be rendered outside the `platform_admin` page body and never sent to analytics.
- Gates G3: `tests/ts/demoAdminClient.test.ts` (auth header construction, timeout, 5xx→503, no PII in thrown errors);
  `tests/ts/adminDemosPage.test.ts` role matrix; full G0 set green.

### Step 4 — verify (both, no code)
- Manual verification list, staging/preview only: signed-out `/admin` → login; `tenant_user` `/admin` → tenant root;
  `platform_admin` `/admin` and `/admin/demos` → work; `app.lumenosis.com` root unchanged for tenants.
- **Old-link proof (mandatory, read-only):** for at least 3 already-sent tokens, `GET https://lumenosis.com/demo/<token>`
  returns 200 with **no redirect hop** (assert `curl -sS -o /dev/null -w '%{http_code} %{num_redirects} %{url_effective}'`
  → `200 0 <same url>`). Same assertion for the current public host if different. Any non-zero redirect count fails the gate.
- `/api/demo/[token]/{email,event,voice}` still 200 for those tokens.
- Old `/admin/demos` shared-password path still works end to end (approve only; **no send**).

### Step 5 — contract (NOT IN SCOPE, separately approved)
Only after §4 runs in production for one full window: delete `lib/admin-auth.ts`, `app/admin/demos/*`,
`app/api/admin/*`; rotate `LUMENOSIS_ADMIN_PASSWORD`; remove the dual nav path in A. `DEMO_ROOM_SECRET` rotation
requires a token-migration design first, because it invalidates static-fallback demo tokens.

## 5. Cross-repo API contract

Direction: A (admin) → S (public host). S never calls A. S never learns tenant identity.

Auth: shared-secret HMAC, new env `LUMENOSIS_PLATFORM_API_SECRET` (min 32 chars) in both repos.
Headers on every request:
- `x-lumenosis-ts` — unix seconds, rejected outside ±300s
- `x-lumenosis-nonce` — 32 hex chars, single-use within the skew window
- `x-lumenosis-signature` — `base64url(HMAC_SHA256(secret, METHOD + "\n" + PATH + "\n" + ts + "\n" + nonce + "\n" + sha256hex(body)))`
Compare with `timingSafeEqual`. Failure → `401 {"error":"Unauthorized"}`, no detail. All responses
`Cache-Control: private, no-store`. Rate-limit reuses `lib/demo-rate-limit.ts`.

Shapes:
- `GET /api/platform/demos?status=&limit=&cursor=` →
  `{ demos: [{ id, prospectName, businessName, prospectEmail, listingAddress, status, outreachStatus, createdAt, demoUrl }], nextCursor }`.
  `demoUrl` is produced by S (S owns the public host), never composed in A.
- `POST /api/platform/demos/[id]/approve` with `{ idempotencyKey }` → `{ ok: true, status: "approved" }`.
  Idempotent by construction: existing SQL is `... WHERE id = ? AND status = 'draft'`; 0 rows affected on an
  already-approved room must still return `200 { ok: true, status: "approved" }` after re-reading the row, and
  `409` only if the row is missing or in a terminal non-approved state.
- `POST /api/platform/demos/[id]/send` with `{ idempotencyKey }` → `{ ok: true, providerMessageId }`.
  Must not double-send: guard on `outreach_drafts.status = 'draft'` **and** persist `idempotencyKey`
  (new nullable column, `UNIQUE`, additive `db/0002_outreach_idempotency.sql`, `CREATE TABLE IF NOT EXISTS`-style
  additive `ALTER`), returning the stored `provider_message_id` on replay. This is the one schema change allowed,
  and it is additive-only.
- `POST /api/platform/demos/generate` → mirrors current `generate` input Zod schema exactly; returns `{ id, demoUrl }`.
  Generated links must keep the exact current URL shape so future links match already-sent ones.

Mixed-version rule: A must treat every field except `id` and `status` as optional and tolerate unknown fields;
S must never remove or rename a field without a version bump. A sends `x-lumenosis-api-version: 1`; S rejects
unknown versions with `400`, so an old S never mis-parses a new A.

## 6. Old-link and tracking preservation (hard invariants)

- `/demo/[token]` route path, token format (43-char base64url), and `token_hash` lookup unchanged.
- **No redirects added** on any public host path, no `next.config.ts` redirects/rewrites, no middleware added to S.
- `DEMO_ROOM_SECRET` not rotated in this migration.
- `content/demo-rooms.ts` static fallback left intact.
- `app/api/demo/[token]/{email,event,voice}` untouched; `engagement_events` writes unchanged so tracking continuity holds.
- The hardcoded `https://lumenosis.com/demo/${token}` string stays as-is until B1 is answered; if it must change,
  it changes only for *new* links and only after proving both hosts serve the path without redirect.

## 7. Rollback

- Step 0: revert commit; no surface change.
- Step 1: A revert of `app/admin/*` + `lib/adminGuard.ts`; nav link reverts to in-page view (dual path exists
  precisely so this is a no-downtime revert). No DB change to undo.
- Step 2: S routes are additive; delete or 404 them. `db/0002` is additive and nullable — leaving it in place is safe;
  no down-migration required.
- Step 3: A revert; old `/admin/demos` on S is still live, so demo operations never lose a working path.
- Any step: because no data moves and no route is removed, rollback is code-only. That property is the reason
  contraction is deferred.

## 8. Branch / PR topology

- `feature/admin-command-center` → `main` (PR #7), Step 0 only. Merge first; do not stack on an unmerged base.
- `feature/admin-route-shell` (A, off `main` after merge) — Step 1.
- `feature/platform-demos-api` (S, off `main`) — Step 2. Independent, merge/deploy before Step 3.
- `feature/admin-demos-panel` (A, off Step 1's merge) — Step 3.
- Deploy order is strictly S-before-A within Step 2→3 (consumer never ships before producer).
- `feature/iris-dashboard-redesign` conflicts with Step 1 at `IrisDashboard.tsx:236-246`. Do not start Step 1 until B4
  is decided.

## 9. Explicit exclusions

Not in this migration: any production deploy; applying any migration; merging to `main`; sending any email;
any destructive or `DELETE`/`DROP` operation; deleting `lib/admin-auth.ts` or `/admin/demos` on S; rotating
`DEMO_ROOM_SECRET` or `LUMENOSIS_ADMIN_PASSWORD`; moving demo data to Postgres; moving `inbox-audit` or `preview/*`
off the public host; adding any redirect or middleware to the public host; anything university-related; resolving the
submodule-vs-sibling duplication of `lumenosis-site`.

## 10. Blockers requiring user decision

- **B1** Which host actually serves `lumenosis.com/demo/*` today, and is it the same deployment as the current public
  host? Already-sent emails use `https://lumenosis.com/demo/<token>` (`generate/route.ts:222`), which contradicts the
  `trylumenosis.com` convention in memory. Cannot certify the no-redirect invariant without this.
- **B2** Approve `LUMENOSIS_PLATFORM_API_SECRET` HMAC service auth (A→S over HTTP) instead of giving the admin app
  Turso credentials. Recommended: yes.
- **B3** Approve the single additive schema change on S (`outreach_drafts` idempotency key) needed for safe
  non-duplicating sends. Without it, `send` cannot be made idempotent.
- **B4** Order `feature/iris-dashboard-redesign` before or after Step 1 (same-file conflict at
  `IrisDashboard.tsx:236-246`).
- **B5** Confirm demo management is internal-only (no tenant visibility), so `demo_rooms` needs no `client_id`.
- **B6** Confirm D2 (ledger status mapping) may be fixed inside Step 0 rather than as its own PR — it changes
  reported success/error rates.
