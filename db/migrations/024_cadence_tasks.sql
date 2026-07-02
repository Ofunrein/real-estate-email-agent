create extension if not exists pgcrypto;

-- Durable GHL-style follow-up queue. Cadence stays in data/state, not prompts.
create table if not exists cadence_tasks (
  id text not null,
  client_id text not null references clients(id) on delete cascade,
  lead_identity text not null default '',
  channel text not null default '',
  reason text not null default '',
  status text not null default 'queued',
  due_at timestamptz not null,
  touch_count integer not null default 0,
  lead_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  last_error text not null default '',
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, id)
);

create index if not exists cadence_tasks_due_idx
  on cadence_tasks (client_id, status, due_at asc);

create index if not exists cadence_tasks_lead_idx
  on cadence_tasks (client_id, lead_identity, updated_at desc);
