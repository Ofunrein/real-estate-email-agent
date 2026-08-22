-- Opt-in mailbox organization. Every default here is "do not touch the user's inbox":
-- categorization off, existing labels respected, nothing archived, no strictness, no rules,
-- no onboarding choice recorded, and no start action taken.
--
-- `labelling_started_at` is the ONE explicit start action. It stays null until the user presses
-- start, and lib/inboxSettings.ts#categorizationActive requires BOTH it and
-- `categorization_enabled` before any mail is reorganized.
alter table inbox_settings
  add column if not exists categorization_enabled boolean not null default false,
  add column if not exists respect_existing_labels boolean not null default true,
  add column if not exists archive_after_send boolean not null default false,
  add column if not exists marketing_strictness text not null default 'off',
  add column if not exists category_rules jsonb not null default '[]'::jsonb,
  add column if not exists onboarding_choice text not null default '',
  add column if not exists labelling_started_at timestamptz;

-- Reject strictness values the application does not understand rather than letting an unknown
-- string be read as a stricter filter than the user chose.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inbox_settings_marketing_strictness_check'
  ) then
    alter table inbox_settings
      add constraint inbox_settings_marketing_strictness_check
      check (marketing_strictness in ('off', 'obvious_sales', 'cold_and_unknown', 'cold_unknown_newsletters', 'not_useful_to_work'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'inbox_settings_onboarding_choice_check'
  ) then
    alter table inbox_settings
      add constraint inbox_settings_onboarding_choice_check
      check (onboarding_choice in ('', 'leave_unchanged', 'attention_only', 'custom'));
  end if;
end $$;

-- Existing rows keep their organization untouched: no backfill flips any of the new flags on.

-- Short human label shown next to each category toggle in settings. Never written to a mailbox.
alter table inbox_categories
  add column if not exists description text not null default '';
