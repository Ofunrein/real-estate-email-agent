# Demo ownership: verification record

What was actually executed while building PR #7, against a real PostgreSQL 16 instance and
a real SQLite source shaped like the Turso database. This is the evidence behind the
claims in `docs/architecture/2026-09-08-demo-data-ownership.md`.

No remote database was touched. No production data was read. No email was sent.

## Environment

- PostgreSQL 16, local, throwaway database `demotest`.
- Source: a local SQLite file served over a stub of the Turso HTTP pipeline API
  (`scripts/dev/fake-turso.mjs`), so the migrator exercised its real HTTP client, batching,
  retry and checkpoint code rather than a mock.
- Fixture: 1,249 rows — 250 prospects, 250 listings, 250 rooms, 250 outreach drafts,
  249 engagement events. Included unicode (`REALTOR®`), NULLs in nullable timestamps, and
  tokens with `-` and `_`.

## Schema and roles

- `033` and `034` applied cleanly, and applied **twice** cleanly — every object is
  guarded, so re-running is safe.
- Role boundaries were tested by connecting **as each role** and attempting forbidden
  statements, not by reading the grant table:
  - `demo_public_reader`: `SELECT` succeeded on all five demo tables; `INSERT`, `UPDATE`,
    `DELETE` were denied; `SELECT` on `clients` was denied; `CREATE TABLE` was denied.
  - `demo_engagement_writer`: `INSERT` into `demo_engagement_events` succeeded;
    `SELECT` on that same table was denied; `UPDATE`/`DELETE` denied; `SELECT` on
    `demo_prospects` and `demo_outreach_drafts` denied.

## Three defects found by execution

Each of these passed review by inspection and failed the moment it met a real server. Each
now has a regression test in `tests/ts/demoOwnershipSchema.test.ts`.

1. **Generated `timestamptz` columns were rejected.** Postgres raised
   `generation expression is not immutable`, because the `text -> timestamptz` cast depends
   on the session timezone. Replaced with the `demo_rooms_utc` /
   `demo_engagement_events_utc` views.
2. **A partial unique index broke `ON CONFLICT` inference.** The migrator's idempotent
   insert infers `(client_id, source_rowid)`; with a `WHERE` clause on the index Postgres
   raised `no unique or exclusion constraint matching the ON CONFLICT specification`. The
   index is now non-partial.
3. **The writer role could not use `RETURNING` or `ON CONFLICT`.** Both need `SELECT` on
   the target table, which the writer deliberately lacks —
   `permission denied for table demo_engagement_events`. The engagement write is a plain
   `INSERT`. This constrains PR #8 and is documented in `034`.

## Migration behaviour

| Scenario | Result |
| --- | --- |
| `--dry-run` | Reported parity, wrote **0** rows. Target row count unchanged. |
| First real run | 250 / 250 / 250 / 250 / 249 copied. All 5 checksums matched. |
| Immediate re-run | **0** rows copied, parity still `match`. Idempotent. |
| Injected transient failures (every 3rd request returned 503) | Retried with backoff and still reached full parity. |
| Resume from a rewound checkpoint | Copied exactly the 150 missing rows, no duplicates. |
| Rows deleted *below* a checkpoint | Plain re-run did **not** repair them; parity correctly reported the gap; `--reset` repaired it. Documented as a caveat. |

Preservation was checked by comparing values, not counts: ids, access tokens, token
hashes, timestamp strings, NULLs and unicode all survived byte-for-byte.

## Secret hygiene

The migrator was run with a `DATABASE_URL` containing a recognisable password and with a
Turso auth token set, on both the success and the error path. Neither value, nor any
access token, prospect mailbox, recipient or draft body, appeared in stdout or stderr.

## Test suite

`npm test` — 989 pre-existing tests pass with these changes in place. The new files add:

- `tests/ts/demoOwnershipStore.test.ts` — 18 tests. Drives the real SQL through an injected
  query function: tenant scoping on every read, claim-before-send ordering, claim release
  on provider failure / network throw / missing key, replay safety, and verbatim token
  handling.
- `tests/ts/demoOwnershipSchema.test.ts` — 19 tests. Freezes the preservation contract and
  the privilege boundary, including the three defects above.
- `tests/ts/demoOwnershipCutover.test.ts` — 4 tests. Mixed-version safety: the flag must be
  exactly `postgres`, and once it is, no outbound request is made even when the platform
  API is fully configured.
