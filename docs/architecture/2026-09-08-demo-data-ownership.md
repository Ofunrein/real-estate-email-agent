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
- **lumenosis-site reads the shared Neon rows directly** through a dedicated
  least-privilege read-only role. It does **not** receive the application
  `DATABASE_URL`, and it does **not** call this app on every public page view.

That last point is the reason for the whole change: a public demo view previously cost an
app-to-app request. Now it is a direct indexed read by a role that can do nothing else.

## Why a database role instead of an API

An API between the two apps would have kept the extra hop, and the hop is what we set out
to remove. A read-only role gives the site exactly the rows it needs with a privilege
boundary the database enforces, rather than one the calling app promises to respect.

The boundary is two roles, defined in `db/migrations/034_demo_reader_role.sql`:

| Role | May do | May not do |
| --- | --- | --- |
| `demo_public_reader` | `SELECT` on the five `demo_*` tables | any write; any other table, including `clients` and `usage_cost_ledger`; create objects |
| `demo_engagement_writer` | `SELECT demo_rooms`, `INSERT demo_engagement_events` | read back, update or delete events; touch prospects, listings or outreach |

Both start from a full `REVOKE`, are `NOLOGIN` in the migration (the runbook attaches
credentials out of band), and have default privileges revoked so a future table is not
exposed by accident.

One consequence, found by running it rather than by reading it: the writer role cannot use
`INSERT ... RETURNING` or `ON CONFLICT`, because both require `SELECT` on the target. The
engagement write is therefore a plain fire-and-forget `INSERT`. This is a deliberate
trade: the public path gives up read-back in exchange for not being able to read the
engagement log at all.

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
- Status domains stay exactly as Turso had them (`draft`/`approved`, `draft`/`sent`), not
  widened.
- Referential relationships and cascade behaviour are preserved.

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
equal checksums mean equal content and not merely equal counts. Transient failures retry
with bounded backoff; a non-transient failure stops with the checkpoint intact. No secret,
token, mailbox, recipient or draft body is ever printed.

**Caveat worth knowing before you trust a green run.** A checkpoint records "I copied up to
key K", not "the target is intact up to K". If rows are deleted from the target *below* a
checkpoint, a plain re-run walks forward from K and will not repair them. Parity still
reports the gap. The fix is `--reset`; inserts are `ON CONFLICT DO NOTHING`, so a reset is
safe and non-duplicating. Trust `parity: match`, not the absence of errors.

## Rollback

The Turso database is not modified or dropped by any of this. Rollback within the
compatibility window is `DEMO_DATA_OWNER` unset plus a redeploy — the legacy path resumes
against data that never stopped being valid. After the window, rolling back means
replaying writes that landed in Neon, which is why the window exists.

## Verification

Evidence from running this against a real PostgreSQL 16 and a SQLite source, including the
three defects that only appeared under execution: `docs/proof/demo-ownership-verification.md`.
