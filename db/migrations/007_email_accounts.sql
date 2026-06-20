-- Per-client Gmail mailbox connections for hosted Iris email.
-- Dashboard Google sign-in stays separate; this table stores the mailbox Iris
-- reads and replies from.
create table if not exists email_accounts (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  provider text not null default 'gmail',
  email text not null,
  display_name text not null default '',
  token_json_encrypted text not null,
  scopes text[] not null default '{}',
  is_default boolean not null default true,
  status text not null default 'connected',
  connected_by text not null default '',
  last_error text not null default '',
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider, email)
);

create unique index if not exists email_accounts_one_default_idx
  on email_accounts (client_id, provider)
  where is_default = true;

create index if not exists email_accounts_client_status_idx
  on email_accounts (client_id, status, updated_at desc);
