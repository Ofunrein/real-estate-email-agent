create table if not exists thread_read_states (
  client_id text not null references clients(id) on delete cascade,
  thread_ref text not null,
  channel text not null default '',
  seen_at timestamptz not null default now(),
  seen_event_at timestamptz,
  seen_by text not null default 'owner',
  updated_at timestamptz not null default now(),
  primary key (client_id, thread_ref, channel)
);

create index if not exists thread_read_states_client_seen_idx
  on thread_read_states (client_id, updated_at desc);
