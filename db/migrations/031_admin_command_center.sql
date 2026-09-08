alter table clients
  add column if not exists status text not null default 'active',
  add column if not exists plan_code text not null default '',
  add column if not exists plan_name text not null default '',
  add column if not exists billing_currency text not null default 'USD',
  add column if not exists monthly_price_cents bigint,
  add column if not exists monthly_attempt_quota bigint,
  add column if not exists monthly_input_unit_quota bigint,
  add column if not exists monthly_output_unit_quota bigint,
  add column if not exists monthly_spend_quota_usd numeric(18, 10),
  add column if not exists billing_period_started_at timestamptz,
  add column if not exists billing_period_ends_at timestamptz,
  add column if not exists activated_at timestamptz;

create table if not exists usage_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  correlation_id text not null,
  attempt_id text not null,
  request_id text not null default '',
  parent_attempt_id text not null default '',
  agent text not null default '',
  channel text not null default '',
  operation text not null,
  provider text not null default '',
  model text not null default '',
  status text not null,
  retry_number integer not null default 0,
  fallback_from_provider text not null default '',
  latency_ms integer,
  input_units bigint not null default 0,
  output_units bigint not null default 0,
  cache_read_units bigint not null default 0,
  cache_write_units bigint not null default 0,
  billable_quantity numeric(24, 8) not null default 0,
  billable_unit text not null default '',
  cost_usd numeric(18, 10) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  unique (client_id, attempt_id),
  check (correlation_id <> ''),
  check (attempt_id <> ''),
  check (operation <> ''),
  check (status <> ''),
  check (retry_number >= 0),
  check (latency_ms is null or latency_ms >= 0),
  check (input_units >= 0 and output_units >= 0),
  check (cache_read_units >= 0 and cache_write_units >= 0),
  check (billable_quantity >= 0),
  check (cost_usd >= 0),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists usage_cost_ledger_client_time_idx
  on usage_cost_ledger (client_id, occurred_at desc);

create index if not exists usage_cost_ledger_correlation_idx
  on usage_cost_ledger (client_id, correlation_id, occurred_at, retry_number);

create index if not exists usage_cost_ledger_provider_model_idx
  on usage_cost_ledger (client_id, provider, model, occurred_at desc);

create index if not exists usage_cost_ledger_status_idx
  on usage_cost_ledger (client_id, status, occurred_at desc);

create index if not exists clients_active_status_idx
  on clients (status, updated_at desc);

create or replace function reject_usage_cost_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'usage_cost_ledger is append-only' using errcode = '55000';
end;
$$;

drop trigger if exists usage_cost_ledger_append_only on usage_cost_ledger;
create trigger usage_cost_ledger_append_only
before update or delete on usage_cost_ledger
for each row execute function reject_usage_cost_ledger_mutation();
