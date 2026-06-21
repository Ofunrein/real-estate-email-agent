create table if not exists lead_import_batches (
  id text primary key,
  client_id text not null references clients(id) on delete cascade,
  source_type text not null,
  source_name text not null default '',
  source_provider text not null default '',
  status text not null default 'uploaded',
  filename text not null default '',
  total_rows integer not null default 0,
  imported_count integer not null default 0,
  merged_count integer not null default 0,
  duplicate_count integer not null default 0,
  invalid_count integer not null default 0,
  missing_contact_count integer not null default 0,
  campaign_eligible_count integer not null default 0,
  segment_counts jsonb not null default '{}'::jsonb,
  unmapped_columns text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('uploaded', 'mapped', 'validated', 'imported', 'segmented', 'failed', 'archived')),
  check (source_type in ('csv', 'google_sheets', 'crm', 'manual', 'inbox_history', 'composio'))
);

create index if not exists lead_import_batches_client_recent_idx
  on lead_import_batches (client_id, created_at desc);

create table if not exists lead_import_items (
  id bigserial primary key,
  batch_id text not null references lead_import_batches(id) on delete cascade,
  client_id text not null references clients(id) on delete cascade,
  row_index integer not null,
  status text not null default 'validated',
  dedupe_key text not null default '',
  email text not null default '',
  phone text not null default '',
  full_name text not null default '',
  source_id text not null default '',
  segments text[] not null default '{}',
  campaign_eligible boolean not null default false,
  lead_memory_key text not null default '',
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  error text not null default '',
  created_at timestamptz not null default now(),
  check (status in ('validated', 'imported', 'merged', 'duplicate', 'invalid', 'skipped')),
  unique (batch_id, row_index)
);

create index if not exists lead_import_items_client_recent_idx
  on lead_import_items (client_id, created_at desc);

create index if not exists lead_import_items_client_dedupe_idx
  on lead_import_items (client_id, dedupe_key);
