-- Reconcile demo_migration_checkpoints with the shape 033_demo_ownership.sql declares.
--
-- Why this exists: an earlier iteration of the demo-ownership work created
-- demo_migration_checkpoints directly against the database with a different column set
-- (rows_copied bigint, running_checksum text). 033 declares the table with
-- `create table if not exists`, which is a no-op against an existing table regardless of
-- its columns, so the stale shape survived 033 being applied and
-- scripts/migrate-demo-data.mjs failed at readCheckpoints with
-- `column "rows_scanned" does not exist`.
--
-- Forward-only and non-destructive:
--   * `rows_scanned` is added if absent, seeded from `rows_copied` when that column is
--     present, so no progress count is lost. The rename direction matters: the migrator
--     deliberately does not call this rows_copied, because ON CONFLICT DO NOTHING means
--     rows scanned and rows actually inserted are different numbers.
--   * `rows_copied` is dropped only after its values have been carried across.
--   * `running_checksum` is dropped: parity is recomputed from both databases on every
--     run (tableChecksum over a canonical digest stream), so a persisted partial
--     checksum is never read and would only be able to disagree with reality.
--   * Constraints and the primary key are asserted idempotently, so re-applying this
--     migration against an already-correct table changes nothing.

do $$
begin
  if to_regclass('public.demo_migration_checkpoints') is null then
    -- 033 has not run against this database, so it owns table creation. Nothing to fix.
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'demo_migration_checkpoints'
       and column_name = 'rows_scanned'
  ) then
    alter table demo_migration_checkpoints
      add column rows_scanned bigint not null default 0;

    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'demo_migration_checkpoints'
         and column_name = 'rows_copied'
    ) then
      update demo_migration_checkpoints
         set rows_scanned = coalesce(rows_copied, 0);
    end if;
  end if;

  alter table demo_migration_checkpoints drop column if exists rows_copied;
  alter table demo_migration_checkpoints drop column if exists running_checksum;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.demo_migration_checkpoints'::regclass
       and conname = 'demo_migration_checkpoints_table_name_check'
  ) then
    alter table demo_migration_checkpoints
      add constraint demo_migration_checkpoints_table_name_check check (table_name <> '');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.demo_migration_checkpoints'::regclass
       and conname = 'demo_migration_checkpoints_rows_scanned_check'
  ) then
    alter table demo_migration_checkpoints
      add constraint demo_migration_checkpoints_rows_scanned_check check (rows_scanned >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.demo_migration_checkpoints'::regclass
       and contype = 'p'
  ) then
    alter table demo_migration_checkpoints
      add primary key (client_id, table_name);
  end if;
end
$$;
