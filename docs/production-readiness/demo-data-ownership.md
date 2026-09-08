# Demo data ownership production-readiness gate

Status: code-ready; no production migration or cutover has been performed.

This checklist separates repository-complete controls from release actions that require an
operator. `scripts/release-demo-ownership.mjs` never deploys, changes application flags,
baselines a database, rotates existing credentials, or sends outreach.

## Code-complete controls

- [x] Neon is the centralized target and this app is the only administrative writer.
- [x] Migration `033` is additive and preserves IDs, slugs, access tokens, token hashes,
  timestamps, statuses, event vocabulary, and existing `/demo/<token>` URL semantics.
- [x] Composite tenant foreign keys prevent cross-tenant parent/child relationships.
- [x] Migration checkpoints are target-side, transactionally advanced, resumable, and safe
  to reset and re-walk with conflict-safe inserts.
- [x] Parity compares row counts and SHA-256 content checksums for all five tables. Text
  preservation fields remain byte-sensitive; only declared numeric columns normalize
  driver representation differences.
- [x] Migration and release CLIs validate arguments, use bounded retries only for transient
  failures, verify TLS by default, emit no row data or secrets, and close connections before
  returning a gate failure.
- [x] Release application is atomic and ledgered. Missing baselines, missing prior entries,
  and migration checksum drift fail closed.
- [x] `demo_public_reader` and `demo_engagement_writer` have no direct table or sequence
  grants, no inheritance, no elevated attributes, and access only three fixed-shape
  functions in `demo_public_api`.
- [x] Public lookup is indexed by one opaque token hash and returns only room ID, config JSON,
  and expiry. It cannot enumerate rooms or expose tokens, prospects, recipients, drafts, or
  provider identifiers.
- [x] Engagement inputs and durations are constrained in both function and table layers.
  Email-generation caps are checked and appended under locks, preventing concurrent cap
  bypass.
- [x] Admin approve and send operations are tenant-scoped and idempotent. Explicit provider
  rejection releases a claim; an ambiguous transport result retains it for reconciliation
  so an automatic retry cannot duplicate an email.
- [x] Cutover flags accept only exact `postgres`; the Neon path fails closed and never falls
  back to an app-to-app request.
- [x] Rollback mechanics are documented for both read and write flags, including the
  non-symmetric case after new Neon writes.
- [x] Disposable real-Postgres coverage applies the release twice, creates role credentials,
  connects as both roles, exercises allowed functions, denies direct table operations,
  rejects a cross-tenant reference, and verifies atomic generation limits.
- [x] Focused/full TypeScript tests, Python tests, lint/typecheck, build, secret scan, routing
  eval, and `git diff --check` are required CI/release evidence.

## Operator sequence: not executed by this PR

1. Merge PR #7 before PR #8. Deploy both with ownership/source flags unset.
2. Confirm the target has a correct `schema_migrations` ledger. If it predates the ledger,
   review and run the repository's explicit migration baseline procedure; the release script
   will not infer or write a baseline.
3. Run `node scripts/release-demo-ownership.mjs --apply`, then generate different 24+
   character credentials in the approved secret manager and run `--grant-password` through
   environment variables. Never put credentials in argv, source, tickets, or logs.
4. Run `node scripts/migrate-demo-data.mjs`. If interrupted, rerun; if parity reports a gap
   below a checkpoint, use `--reset` and rerun. Require `--verify` and release `--check` to
   pass immediately before cutover.
5. Configure lumenosis-site with the function-role read/write URLs only. It must not receive
   this app's administrative `DATABASE_URL`.
6. Set lumenosis-site `DEMO_DATA_SOURCE=postgres` first. Verify a previously issued token
   resolves with identical content and that unknown/expired tokens fail as before.
7. Set this app's `DEMO_DATA_OWNER=postgres` only after the read verification passes.
8. Monitor errors, role denials, engagement volume, generation caps, outreach send claims,
   and parity/reconciliation during the fallback window. Do not delete or modify Turso.

## Rollback

- Before any new Neon write: unset lumenosis-site `DEMO_DATA_SOURCE`, then unset this app's
  `DEMO_DATA_OWNER`; redeploy both.
- After a Neon write: stop new admin writes first, reconcile Neon-only sends/events into the
  approved source of truth, then perform the flag rollback. Never blindly replay outreach.
- Schema rollback is intentionally unnecessary: migrations are additive and dormant while
  flags are unset. Do not drop tables, functions, roles, or historical source data during
  the fallback window.

## Human decisions: maximum three

1. Name the release approver, maintenance window, and one existing non-sensitive demo token
   used for pre/post read verification.
2. Choose the secret manager and deployment owner for the two distinct least-privilege
   credentials and application flags.
3. Set the fallback-window length and name the owner of Neon-to-Turso reconciliation if a
   rollback is needed after new writes.
