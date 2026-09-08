-- Demo/prospect/listing/outreach/engagement data ownership moves from Turso (SQLite,
-- owned by lumenosis-site) into this app's Neon/Postgres database. This app becomes the
-- sole writer and admin owner; lumenosis-site reads the same rows directly through a
-- dedicated least-privilege lookup functions (see 034_demo_reader_role.sql) and never
-- receives the application DATABASE_URL or direct table access.
--
-- Additive only. NOT applied to any remote database by this PR — see
-- docs/architecture/2026-09-08-demo-data-ownership.md and scripts/release-demo-ownership.mjs.
--
-- Preservation contract (asserted by tests/ts/demoOwnershipSchema.test.ts):
--
--   * Every id stays TEXT and keeps its exact Turso value. No surrogate keys, no uuid
--     regeneration, no re-slugging. Turso `demo_rooms.id` is `demo_rooms.id` here.
--   * `access_token` and `token_hash` are copied verbatim. Tokens are never re-derived
--     or re-signed, so every https://lumenosis.com/demo/<token> URL already sent to a
--     prospect keeps resolving. The demo-room signing secret is neither read by this
--     schema nor rotated by it; no token material is derived here at all.
--   * Timestamps are preserved as the original text. Turso wrote CURRENT_TIMESTAMP as
--     'YYYY-MM-DD HH:MM:SS' (UTC, no zone marker). Casting that to timestamptz at
--     migration time would silently reinterpret it in the server timezone, so the
--     canonical columns stay `text` and hold the original bytes. Sortable-as-text
--     lexicographically, which is what the existing `ORDER BY created_at DESC` relies
--     on. Where a real timestamptz is wanted for range queries, the `demo_rooms_utc`
--     view at the bottom of this file exposes one by explicitly stamping UTC, without
--     touching the preserved value. (A generated column cannot do this: text-to-
--     timestamptz is not immutable in Postgres, since it depends on the session
--     TimeZone, so the database rejects it in a generated expression. The view is
--     evaluated per query and is therefore allowed to do the same cast.)
--   * Statuses are preserved as text with no re-mapping: 'draft'/'approved' for rooms,
--     'draft'/'sent' for outreach, 'draft'/'contacted' for prospects.
--   * Referential relationships are preserved with the same cascade behavior Turso
--     declared: prospects -> listings/demo_rooms -> outreach_drafts/engagement_events.
--
-- Tenant scoping: every table carries `client_id text not null references clients(id)`,
-- matching the ~45 existing tenant tables. Turso had no tenant column (it was
-- single-tenant by construction), so the migration stamps every imported row with one
-- client id (DEMO_CLIENT_ID, default 'default') and that id is what the read-only role
-- is scoped to.

create table if not exists demo_prospects (
  id text primary key,
  client_id text not null references clients(id) on delete restrict,
  full_name text not null,
  first_name text not null,
  email text not null,
  business_name text not null,
  role text not null default 'REALTOR®',
  sender_inbox text not null default 'iris-demo@agentmail.to',
  status text not null default 'draft',
  -- Preserved verbatim from Turso; see header note on timestamps.
  created_at text not null,
  imported_at timestamptz not null default now(),
  check (id <> ''),
  check (full_name <> ''),
  check (email <> ''),
  check (created_at <> ''),
  check (status in ('draft', 'contacted')),
  unique (client_id, id)
);

create table if not exists demo_listings (
  id text primary key,
  client_id text not null references clients(id) on delete restrict,
  prospect_id text not null,
  address text not null,
  source_url text not null,
  status text not null,
  price bigint not null,
  beds double precision not null,
  baths double precision not null,
  square_feet bigint not null,
  acreage double precision not null,
  mls text not null,
  -- Turso stored these as TEXT holding JSON. jsonb would reformat and reorder keys, so
  -- the bytes stay text and a companion view is not needed: nothing queries inside them.
  details_json text not null,
  sources_json text not null,
  verified_at text not null,
  imported_at timestamptz not null default now(),
  check (id <> ''),
  check (address <> ''),
  unique (client_id, id),
  foreign key (client_id, prospect_id)
    references demo_prospects(client_id, id) on delete cascade
);

create table if not exists demo_rooms (
  id text primary key,
  client_id text not null references clients(id) on delete restrict,
  prospect_id text not null,
  listing_id text not null,
  slug text not null,
  -- Copied verbatim. The public site resolves a visitor's token by hashing it and
  -- matching token_hash; access_token is what the admin app renders as a sent link.
  token_hash text not null,
  access_token text not null,
  config_json text not null,
  status text not null default 'draft',
  expires_at text not null,
  approved_at text,
  created_at text not null,
  imported_at timestamptz not null default now(),
  check (id <> ''),
  check (slug <> ''),
  check (token_hash <> ''),
  check (access_token <> ''),
  check (created_at <> ''),
  check (expires_at <> ''),
  -- Turso allowed only these two values; preserved, not widened.
  check (status in ('draft', 'approved')),
  unique (client_id, id),
  foreign key (client_id, prospect_id)
    references demo_prospects(client_id, id) on delete cascade,
  foreign key (client_id, listing_id)
    references demo_listings(client_id, id) on delete cascade
);

-- Turso declared slug and token_hash globally UNIQUE. Preserved as global uniqueness
-- rather than per-tenant: a demo token must resolve to exactly one room regardless of
-- tenant, because the public /demo/[token] lookup is not tenant-scoped.
create unique index if not exists demo_rooms_slug_key on demo_rooms (slug);
create unique index if not exists demo_rooms_token_hash_key on demo_rooms (token_hash);

create table if not exists demo_outreach_drafts (
  id text primary key,
  client_id text not null references clients(id) on delete restrict,
  demo_room_id text not null unique,
  sender_name text not null,
  sender_inbox text not null,
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'draft',
  sent_at text,
  provider_message_id text,
  -- From Turso db/0002_outreach_idempotency.sql, which was also never applied there.
  idempotency_key text,
  imported_at timestamptz not null default now(),
  check (id <> ''),
  check (recipient <> ''),
  check (status in ('draft', 'sent')),
  unique (client_id, id),
  foreign key (client_id, demo_room_id)
    references demo_rooms(client_id, id) on delete cascade
);

create unique index if not exists demo_outreach_drafts_idempotency_key
  on demo_outreach_drafts (idempotency_key)
  where idempotency_key is not null;

-- Turso used INTEGER PRIMARY KEY AUTOINCREMENT here. This is the one id that is not
-- preserved by value: SQLite rowids are per-database counters, not stable identifiers,
-- and nothing outside the table references them. The migration preserves the ORDER by
-- carrying the original rowid in `source_rowid`, which is unique per tenant so a
-- re-run cannot double-insert an event.
create table if not exists demo_engagement_events (
  id bigserial primary key,
  client_id text not null references clients(id) on delete restrict,
  demo_room_id text not null,
  event text not null,
  duration_seconds integer,
  created_at text not null,
  source_rowid bigint,
  imported_at timestamptz not null default now(),
  check (event <> ''),
  check (created_at <> ''),
  check (duration_seconds is null or (duration_seconds >= 0 and duration_seconds <= 180)),
  -- Preserved from the public site's zod enum. Widening this requires a new migration,
  -- which is the point: the public write path cannot invent event names.
  check (event in (
    'viewed',
    'email_completed',
    'voice_started',
    'voice_completed',
    'repeat_visit',
    'booking_clicked',
    -- Internal paid-generation reservation written by lumenosis-site's existing
    -- demo budget gate. It exists in the source corpus even though visitors cannot
    -- submit it through the public event route.
    'email_generation_started'
  )),
  foreign key (client_id, demo_room_id)
    references demo_rooms(client_id, id) on delete cascade
);

-- NOT partial. A partial unique index (`where source_rowid is not null`) cannot be used
-- for `ON CONFLICT (...)` inference in Postgres, and the migrator's idempotent insert
-- depends on inferring exactly this constraint. A plain unique index works because
-- Postgres treats NULLs as distinct, so rows written later by the public path (which
-- have no source_rowid) never collide with each other or with imported rows.
create unique index if not exists demo_engagement_events_source_rowid_key
  on demo_engagement_events (client_id, source_rowid);

create index if not exists demo_prospects_client_idx on demo_prospects (client_id, created_at desc);
create index if not exists demo_listings_prospect_idx on demo_listings (client_id, prospect_id);
create index if not exists demo_rooms_client_created_idx on demo_rooms (client_id, created_at desc);
create index if not exists demo_rooms_status_idx on demo_rooms (client_id, status, created_at desc);
create index if not exists demo_rooms_prospect_idx on demo_rooms (client_id, prospect_id);
create index if not exists demo_outreach_drafts_room_idx on demo_outreach_drafts (demo_room_id);
create index if not exists demo_outreach_drafts_status_idx
  on demo_outreach_drafts (client_id, status);
create index if not exists demo_engagement_events_room_idx
  on demo_engagement_events (demo_room_id, created_at desc);

-- Migration checkpoint ledger for scripts/migrate-demo-data.mjs. Lives in the target
-- database so a resumed run cannot disagree with what actually landed, and so a
-- checkpoint cannot be lost with the machine that ran it.
create table if not exists demo_migration_checkpoints (
  client_id text not null references clients(id) on delete restrict,
  table_name text not null,
  -- Last source key copied, in the deterministic order the migrator walks. Resume
  -- restarts strictly after this value.
  last_source_key text not null default '',
  -- Source rows durably scanned through this checkpoint. This is intentionally not
  -- named rows_copied: ON CONFLICT may skip an already-present target row on a reset.
  rows_scanned bigint not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (client_id, table_name),
  check (table_name <> ''),
  check (rows_scanned >= 0)
);

-- Timestamptz companions for range queries, without mutating the preserved text.
-- Turso wrote every timestamp as UTC with no zone marker, so '+00' is appended
-- explicitly rather than letting the session TimeZone decide. Read-only by nature; the
-- canonical columns remain the source of truth.
create or replace view demo_rooms_utc as
  select
    id,
    client_id,
    prospect_id,
    listing_id,
    slug,
    status,
    created_at,
    (created_at || '+00')::timestamptz as created_at_utc,
    expires_at,
    (expires_at || '+00')::timestamptz as expires_at_utc,
    approved_at,
    case when approved_at is null then null else (approved_at || '+00')::timestamptz end
      as approved_at_utc
  from demo_rooms;

create or replace view demo_engagement_events_utc as
  select
    id,
    client_id,
    demo_room_id,
    event,
    duration_seconds,
    created_at,
    (created_at || '+00')::timestamptz as created_at_utc,
    source_rowid
  from demo_engagement_events;
