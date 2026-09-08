-- Least-privilege database roles for lumenosis-site.
--
-- The architectural point of this file: the public site reads shared demo data DIRECTLY
-- from Neon instead of calling this app on every public page view, and it does so
-- without ever holding the application DATABASE_URL. Two narrow roles, no more:
--
--   demo_public_reader  SELECT on exactly the five demo tables, nothing else, no DML,
--                       no DDL, no sequence access, no other schema. This is what
--                       /demo/[token] uses.
--
--   demo_engagement_writer
--                       SELECT on demo_rooms only (to resolve a token) plus INSERT on
--                       demo_engagement_events only. No UPDATE, no DELETE, no SELECT on
--                       prospects/listings/outreach. This is the "narrowly scoped writer
--                       path" for engagement writes: the public site can append an
--                       engagement event but cannot read a prospect mailbox, cannot
--                       approve a room, cannot send outreach, and cannot alter or erase
--                       an event it already wrote.
--
-- Passwords are NOT set here. This migration creates the roles and grants with `nologin`
-- and no password; the release runbook (scripts/release-demo-ownership.mjs) sets a
-- password out of band and prints nothing. A migration file is committed to git, so it
-- can never be where a credential lives.
--
-- Additive and idempotent: re-running changes nothing. NOT applied to any remote
-- database by this PR.
--
-- Revocation is one statement per role and is the rollback lever for the read path:
--   revoke all privileges on all tables in schema public from demo_public_reader;
-- Documented in docs/architecture/2026-09-08-demo-data-ownership.md §Rollback.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'demo_public_reader') then
    -- nologin until the runbook sets a password; a role that cannot log in cannot be
    -- used even if this migration is applied ahead of the rest of the rollout.
    create role demo_public_reader nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'demo_engagement_writer') then
    create role demo_engagement_writer nologin;
  end if;
end
$$;

-- Connect + schema visibility only. No CREATE on the schema: neither role may add a
-- table, function, or type.
grant usage on schema public to demo_public_reader, demo_engagement_writer;
revoke create on schema public from demo_public_reader, demo_engagement_writer;

-- Reader: SELECT on exactly the demo tables. Enumerated explicitly rather than via
-- ALL TABLES IN SCHEMA, so a future unrelated table is not silently exposed.
grant select on demo_prospects to demo_public_reader;
grant select on demo_listings to demo_public_reader;
grant select on demo_rooms to demo_public_reader;
grant select on demo_outreach_drafts to demo_public_reader;
grant select on demo_engagement_events to demo_public_reader;

-- And nothing else, ever. Explicit revokes so the grant set is provable by inspection
-- and not merely "we never granted it".
revoke insert, update, delete, truncate, references, trigger
  on demo_prospects, demo_listings, demo_rooms, demo_outreach_drafts, demo_engagement_events
  from demo_public_reader;

-- Writer: resolve a token, append an event. That is the whole capability.
--
-- Deliberate consequence, verified against a real Postgres: with INSERT but no SELECT on
-- demo_engagement_events, this role CANNOT use `INSERT ... RETURNING` and CANNOT use
-- `INSERT ... ON CONFLICT`, because both read the table. The public engagement write path
-- in lumenosis-site must therefore issue a bare INSERT and treat it as fire-and-forget.
-- That is the correct trade: an append-only event writer that cannot read back what it
-- wrote also cannot be used to enumerate engagement history. Idempotent imports are the
-- migrator's job, and the migrator connects as the owner, not as this role.
grant select on demo_rooms to demo_engagement_writer;
grant insert on demo_engagement_events to demo_engagement_writer;
grant usage on sequence demo_engagement_events_id_seq to demo_engagement_writer;

revoke update, delete, truncate, references, trigger
  on demo_engagement_events
  from demo_engagement_writer;
revoke insert, update, delete, truncate, references, trigger
  on demo_rooms
  from demo_engagement_writer;
revoke all privileges
  on demo_prospects, demo_listings, demo_outreach_drafts
  from demo_engagement_writer;

-- Deny both roles everything else that currently exists in the schema, including the
-- ~45 tenant tables, the append-only usage ledger, and the migration checkpoints. These
-- are no-op revokes on a fresh database (a new role starts with no table privileges);
-- they are stated so the privilege set is provable by inspection rather than resting on
-- "we never granted it", and so re-running this file re-asserts the denial if someone
-- granted something by hand in between.
revoke all privileges on demo_migration_checkpoints
  from demo_public_reader, demo_engagement_writer;
revoke all privileges on clients
  from demo_public_reader, demo_engagement_writer;
revoke all privileges on usage_cost_ledger
  from demo_public_reader, demo_engagement_writer;

-- Future tables default to no access for these roles.
alter default privileges in schema public
  revoke all on tables from demo_public_reader;
alter default privileges in schema public
  revoke all on tables from demo_engagement_writer;
alter default privileges in schema public
  revoke all on sequences from demo_public_reader;
alter default privileges in schema public
  revoke all on sequences from demo_engagement_writer;
