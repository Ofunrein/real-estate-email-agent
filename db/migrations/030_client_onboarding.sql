create table if not exists onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  provider text not null default 'typeform',
  provider_response_id text not null,
  idempotency_key text not null,
  state text not null default 'intake_complete',
  contact_email text not null default '',
  company_name text not null default '',
  intake jsonb not null default '{}'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  external_ids jsonb not null default '{}'::jsonb,
  last_error text not null default '',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider, provider_response_id),
  unique (client_id, idempotency_key),
  check (state in ('commercial_pending','intake_sent','intake_complete','access_pending','configured','sandbox_ready','launch_review','live','blocked'))
);

create table if not exists onboarding_steps (
  id bigserial primary key,
  session_id uuid not null references onboarding_sessions(id) on delete cascade,
  step_key text not null,
  status text not null default 'pending',
  provider_id text not null default '',
  detail jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (session_id, step_key),
  check (status in ('pending','running','complete','blocked','failed','skipped'))
);

create index if not exists onboarding_sessions_client_state_idx on onboarding_sessions (client_id, state, updated_at desc);
