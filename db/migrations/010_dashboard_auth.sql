-- Dashboard email/password sign-in and password reset tokens.
create table if not exists dashboard_users (
  client_id text not null references clients(id) on delete cascade,
  email text not null,
  password_hash text not null default '',
  reset_token_hash text not null default '',
  reset_expires_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, email)
);

create index if not exists dashboard_users_reset_token_idx
  on dashboard_users (client_id, reset_token_hash)
  where reset_token_hash <> '';
