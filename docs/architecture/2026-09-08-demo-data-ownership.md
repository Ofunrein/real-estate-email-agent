# Demo data ownership moves to Neon

Status: implemented across PR #7 (this repo) and PR #8 (lumenosis-site). Not yet applied
to any remote database. Applying it is a release operation, not a code change — see
`scripts/release-demo-ownership.mjs`.

## The decision

Demo, prospect, listing, outreach and engagement data moves out of Turso (SQLite, owned
by lumenosis-site) and into this app's Neon/Postgres database.

- **This app is the sole writer and the admin owner.** Every create, approve and send
  happens here.
- **lumenosis-site keeps the exact public `/demo/<token>` URLs and token semantics.**
  Nothing a prospect has already received changes.
- **lumenosis-site reads the shared Neon database directly** through a dedicated
  least-privilege function role. It does **not** receive the application `DATABASE_URL`,
  cannot enumerate a table, and does **not** call this app on every public page view.

That last point is the reason for the whole change: a public demo view previously cost an
app-to-app request. Now it is a direct indexed read by a role that can do nothing else.

## Why a database role instead of an API

An API between the two apps would have kept the extra hop, and the hop is what we set out
to remove. A read-only role gives the site exactly the rows it needs with a privilege
boundary the database enforces, rather than one the calling app promises to respect.

The boundary is two roles and three `SECURITY DEFINER` functions in a private API schema,
defined in `db/migrations/034_demo_reader_role.sql`:

| Role | May do | May not do |
| --- | --- | --- |
| `demo_public_reader` | execute `lookup_room(token_hash)`; receive only `id`, `config_json`, `expires_at` | enumerate rooms; receive access tokens, hashes, prospect/outreach data; any table access or write |
| `demo_engagement_writer` | execute validated `record_engagement(token_hash, ...)` and atomic `reserve_email_generation(token_hash, limits...)` | any table access; read back, update or delete events; touch prospect, listing or outreach data |

Both start from blanket table/sequence/function revokes, are `NOLOGIN` in the migration
(the release command attaches credentials out of band), have `NOINHERIT`, and receive no
direct table grant. Function inputs are validated, opaque-hash lookups return at most one
room, and the reservation function serializes concurrent cap checks before appending the
event. The reader connection is read-only by default; both roles have bounded statement
and idle-transaction timeouts. Default privileges keep future objects private.

## What is preserved

The migration is additive and copies values byte-for-byte. Asserted by
`tests/ts/demoOwnershipSchema.test.ts` and verified against a real database:

- Every id stays `TEXT` with its exact Turso value. No surrogate keys, no regenerated
  uuids, no re-slugging.
- `access_token` and `token_hash` are copied verbatim. Tokens are never re-derived or
  re-signed, so every `https://lumenosis.com/demo/<token>` link already sent keeps
  resolving. `DEMO_ROOM_SECRET` is not read or rotated by this schema.
- Timestamps stay `text`. Turso wrote `'YYYY-MM-DD HH:MM:SS'` with no zone; casting at
  migration time would silently reinterpret every historical timestamp in the server
  timezone. `demo_rooms_utc` and `demo_engagement_events_utc` offer `timestamptz` for
  reads without touching the canonical column.
- Status and event domains stay exactly as Turso had them, including prospect
  `draft`/`contacted` and `email_generation_started` budget events.
- Referential relationships and cascade behaviour are preserved with composite
  `(client_id, id)` foreign keys, so no child can point across tenant boundaries.

Table names gain a `demo_` prefix, because Turso's bare `prospects` and `listings` would
collide with this app's existing tenant schema. Every table is scoped by
`client_id REFERENCES clients(id)`.

## Mixed-version safety

`DEMO_DATA_OWNER` selects the owner, and only the exact string `postgres` switches it.
Anything else — unset, `true`, `neon`, `POSTGRES` — leaves the legacy signed-API path in
charge. Both apps can therefore be deployed in either order with the flag off, and neither
deploy changes behaviour.

Once the flag is on, the Postgres path **fails closed**: if `DATABASE_URL` is missing it
returns `not_configured` rather than falling back to the platform API. A fallback would
reintroduce the hop and, worse, permit two writers during a rolling deploy. Asserted by
`tests/ts/demoOwnershipCutover.test.ts`.

The old `/admin/demos` page stays compatible during rollout. It is not removed here.

## Migration

`scripts/migrate-demo-data.mjs` — idempotent, resumable, and quiet.

```
node scripts/migrate-demo-data.mjs --dry-run   # read both sides, report parity, write nothing
node scripts/migrate-demo-data.mjs             # migrate (resumable), then report parity
node scripts/migrate-demo-data.mjs --verify    # parity only
node scripts/migrate-demo-data.mjs --reset     # clear checkpoints, re-walk from zero
node scripts/migrate-demo-data.mjs --json      # machine-readable report
```

Parity is a per-table row count plus a deterministic checksum over the row content, so
equal checksums mean equal content and not merely equal counts. Text preservation fields
are never numeric-normalized (`"001"` stays distinct from `"1"`), while declared numeric
columns are normalized across drivers. Every field is length-prefixed before hashing.
Transient source and target failures retry with bounded backoff; a non-transient failure
stops with the checkpoint intact. The script refuses to create schema implicitly, validates
CLI and batch inputs, and reports a one-way tenant fingerprint rather than row IDs. No
secret, token, mailbox, recipient or draft body is printed.

`scripts/release-demo-ownership.mjs` applies `033`/`034` atomically through the existing
`schema_migrations` ledger. It refuses an absent ledger, an unrecorded prior migration, or
a changed checksum; it never guesses a production baseline. `--check` recomputes live
source/target parity and verifies schema, tenant constraints, roles, direct table grants,
function grants, and migration checksums. TLS certificates are verified by default.

**Caveat worth knowing before you trust a green run.** A checkpoint records "I copied up to
key K", not "the target is intact up to K". If rows are deleted from the target *below* a
checkpoint, a plain re-run walks forward from K and will not repair them. Parity still
reports the gap. The fix is `--reset`; inserts are `ON CONFLICT DO NOTHING`, so a reset is
safe and non-duplicating. Trust `parity: match`, not the absence of errors.

## Rollback

The Turso database is not modified or dropped by any of this. Before Neon receives new
writes, read rollback is unsetting lumenosis-site's `DEMO_DATA_SOURCE`; write rollback is
unsetting this app's `DEMO_DATA_OWNER`. After Neon receives a send or engagement event,
rollback is not symmetric: reconcile those writes before returning Turso to ownership.
The release checklist therefore requires a named fallback window and reconciliation owner.

## Verification

Evidence from running this against disposable real PostgreSQL, including credentialed role
connections and forbidden-operation checks: `docs/proof/demo-ownership-verification.md`.
The complete production gate is `docs/production-readiness/demo-data-ownership.md`.
