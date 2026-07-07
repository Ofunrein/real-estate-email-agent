-- Add richer listing context fields for Iris voice/property answers.
-- Safe expand-only migration: nullable text columns with lightweight defaults.

alter table properties
  add column if not exists utilities_included text default '',
  add column if not exists appliances_included text default '',
  add column if not exists parking text default '',
  add column if not exists pet_policy text default '',
  add column if not exists deposit text default '',
  add column if not exists fees text default '',
  add column if not exists lease_terms text default '',
  add column if not exists floor text default '',
  add column if not exists unit_number text default '',
  add column if not exists available_date text default '',
  add column if not exists showing_instructions text default '',
  add column if not exists negotiability_notes text default '',
  add column if not exists listing_agent_name text default '',
  add column if not exists listing_agent_phone text default '';
