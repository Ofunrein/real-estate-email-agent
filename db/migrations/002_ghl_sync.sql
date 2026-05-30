create table if not exists ghl_message_sync (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  event_hash text not null,
  ghl_contact_id text default '',
  ghl_message_id text default '',
  ghl_conversation_id text default '',
  sync_mode text not null default 'dry-run',
  synced_at timestamptz not null default now(),
  unique (client_id, event_hash)
);

create index if not exists idx_ghl_message_sync_client_synced_at
  on ghl_message_sync(client_id, synced_at desc);
