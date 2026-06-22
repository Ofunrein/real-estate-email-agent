create extension if not exists pgcrypto;

create table if not exists channel_connections (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  channel text not null,
  provider text not null,
  external_user_id text not null default '',
  auth_config_id text not null default '',
  connected_account_id text not null default '',
  selected_asset_id text not null default '',
  selected_asset_name text not null default '',
  selected_asset_type text not null default '',
  status text not null default 'needs_config',
  health_reason text not null default '',
  webhook_status text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, channel, provider, selected_asset_id)
);

create index if not exists channel_connections_client_channel_idx
  on channel_connections (client_id, channel, provider);
