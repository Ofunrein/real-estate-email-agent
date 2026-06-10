-- Voice call detail for Aria (Vapi). conversation_events already holds the
-- per-turn/transcript rows; voice_calls holds one row per call with the
-- dashboard-facing metadata: duration, disposition, intents, actions taken.
create table if not exists voice_calls (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  call_id text not null default '',
  thread_ref text not null default '',
  direction text not null default 'inbound',
  email text default '',
  phone text default '',
  full_name text default '',
  lead_role text default '',
  agent_name text default 'Aria',
  started_at text default '',
  ended_at text default '',
  duration_sec integer not null default 0,
  disposition text default '',
  intents text[] not null default '{}',
  actions jsonb not null default '[]'::jsonb,
  summary text default '',
  transcript text default '',
  recording_url text default '',
  ended_reason text default '',
  human_owner text default '',
  created_at timestamptz not null default now(),
  unique (client_id, call_id)
);

create index if not exists idx_voice_calls_client_created_at
  on voice_calls(client_id, created_at desc);
create index if not exists idx_voice_calls_client_thread
  on voice_calls(client_id, thread_ref);
create index if not exists idx_voice_calls_client_phone
  on voice_calls(client_id, phone);
