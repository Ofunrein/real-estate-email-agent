create table if not exists onboarding_commercial_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  customer_id text not null default '',
  customer_email text not null,
  amount integer not null default 0,
  currency text not null default '',
  status text not null default 'processing',
  provider_message_id text not null default '',
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, event_id)
);
