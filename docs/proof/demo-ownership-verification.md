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
- Role boundaries are now exercised on every run of `npm run test:demo-postgres`. The test
  creates a disposable cluster, applies `033`/`034` through the real release CLI twice,
  attaches generated role credentials, and connects **as each role**:
  - `demo_public_reader`: opaque-hash lookup succeeded through
    `demo_public_api.lookup_room`; direct `SELECT` from `demo_rooms` was denied.
  - `demo_engagement_writer`: validated append and atomic cap reservation succeeded through
    their two functions; direct `SELECT` and direct `INSERT` were denied.
  - a room referencing another tenant's parent was rejected by the composite foreign key.
  - applying the release twice recorded both migrations once and skipped both on replay.

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
3. **Direct table grants exposed too much data even when read-only.** A reader of all five
   tables could enumerate access tokens, recipient mailboxes and draft bodies. `034` now
   grants no table privilege at all. Three fixed-shape `SECURITY DEFINER` functions expose
   only one opaque-hash lookup and two validated append operations.

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

- `tests/ts/demoOwnershipStore.test.ts` — drives the real SQL through an injected query
  function: tenant scoping, claim-before-send ordering, release after an explicit provider
  rejection, retained claim after ambiguous transport failure, replay safety, and verbatim
  token handling.
- `tests/ts/demoOwnershipSchema.test.ts` — 19 tests. Freezes the preservation contract and
  the privilege boundary, including the three defects above.
- `tests/ts/demoOwnershipCutover.test.ts` — 4 tests. Mixed-version safety: the flag must be
  exactly `postgres`, and once it is, no outbound request is made even when the platform
  API is fully configured.
- `npm run test:demo-postgres` — disposable real-Postgres integration covering ledgered
  release replay, credential attachment, tenant foreign keys, function-only role access,
  forbidden operations, and atomic budget reservation. It refuses caller database URLs and
  cannot target a remote or production database.
