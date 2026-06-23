create extension if not exists pgcrypto;

-- Shared durability layer for the normalized omnichannel responder pipeline.
-- Existing conversation_events remains the operator-visible event log.

alter table conversation_events
  add column if not exists provider_message_id text default '',
  add column if not exists provider_thread_id text default '',
  add column if not exists media_json jsonb not null default '[]'::jsonb,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb,
  add column if not exists reply_job_id uuid;

create table if not exists event_dedupe (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  dedupe_key text not null,
  channel text not null default '',
  provider text not null default '',
  provider_message_id text not null default '',
  thread_ref text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'seen',
  metadata jsonb not null default '{}'::jsonb,
  unique (client_id, dedupe_key)
);

create index if not exists event_dedupe_thread_idx
  on event_dedupe (client_id, thread_ref, last_seen_at desc);

create table if not exists reply_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  dedupe_key text not null,
  channel text not null,
  provider text not null default '',
  thread_ref text not null,
  contact_ref text not null default '',
  inbound_event_id bigint,
  status text not null default 'received',
  attempts integer not null default 0,
  model_classify text not null default '',
  model_reply text not null default '',
  reply_text text not null default '',
  media_json jsonb not null default '[]'::jsonb,
  error text not null default '',
  next_action text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (client_id, dedupe_key)
);

create index if not exists reply_jobs_status_idx
  on reply_jobs (client_id, status, updated_at desc);

create index if not exists reply_jobs_thread_idx
  on reply_jobs (client_id, thread_ref, updated_at desc);

create table if not exists thread_summaries (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  thread_ref text not null,
  channel text not null default '',
  summary text not null default '',
  last_message_at timestamptz,
  message_count integer not null default 0,
  model text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (client_id, thread_ref)
);

create table if not exists tool_result_cache (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  cache_key text not null,
  tool_name text not null default '',
  result_json jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, cache_key)
);

create index if not exists tool_result_cache_expiry_idx
  on tool_result_cache (client_id, expires_at);
