create extension if not exists pgcrypto;

create table if not exists request_audit_events (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  request_id text not null default '',
  route text not null default '',
  method text not null default '',
  channel text not null default '',
  provider text not null default '',
  thread_ref text not null default '',
  contact_ref text not null default '',
  provider_message_id text not null default '',
  stage text not null default '',
  outcome text not null default '',
  status_code integer,
  duration_ms integer,
  error_code text not null default '',
  error_message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists request_audit_events_created_idx
  on request_audit_events (client_id, created_at desc);

create index if not exists request_audit_events_thread_idx
  on request_audit_events (client_id, thread_ref, created_at desc);

create index if not exists request_audit_events_outcome_idx
  on request_audit_events (client_id, outcome, created_at desc);
