-- Shared, tenant-scoped intelligence state for every channel and tenant.
-- Expand-only: existing lead_memory, conversation_events, properties, and
-- appointments remain the compatibility layer while reducers adopt this state.

create extension if not exists pgcrypto;

create table if not exists conversation_states (
  client_id text not null references clients(id) on delete cascade,
  subject_key text not null,
  version bigint not null default 0 check (version >= 0),
  active_journeys text[] not null default '{}',
  state_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, subject_key),
  check (jsonb_typeof(state_json) = 'object')
);

create index if not exists conversation_states_journeys_idx
  on conversation_states using gin (active_journeys);

create table if not exists property_facts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  property_address text not null,
  field text not null,
  value jsonb,
  status text not null default 'known'
    check (status in ('known', 'unknown', 'stale', 'conflicting')),
  source_name text not null,
  source_url text not null default '',
  source_record_id text not null default '',
  retrieved_at timestamptz not null,
  observed_at timestamptz not null,
  effective_date timestamptz,
  expires_at timestamptz,
  confidence numeric(4,3) not null default 0.800
    check (confidence >= 0 and confidence <= 1),
  raw_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, property_address, field, source_name, raw_hash),
  check (length(raw_hash) = 64),
  check (source_name <> '')
);

create index if not exists property_facts_lookup_idx
  on property_facts (client_id, lower(property_address), field, observed_at desc);
create index if not exists property_facts_freshness_idx
  on property_facts (client_id, expires_at)
  where expires_at is not null;

-- Preserve legacy rows as attributable field-level evidence without pretending a
-- row update refreshed every retained field. Future partial upserts write only
-- the fields actually observed in that import.
insert into property_facts (
  client_id, property_address, field, value, status, source_name,
  source_url, source_record_id, retrieved_at, observed_at,
  effective_date, expires_at, confidence, raw_hash
)
select
  p.client_id,
  p.address,
  fields.field,
  to_jsonb(to_jsonb(p) ->> fields.field),
  case
    when p.updated_at < now() - interval '24 hours' then 'stale'
    else 'known'
  end,
  coalesce(nullif(p.source, ''), 'legacy_property_row'),
  coalesce(p.listing_url, ''),
  lower(p.address),
  p.updated_at,
  p.updated_at,
  p.updated_at,
  p.updated_at + interval '24 hours',
  0.600,
  encode(digest(
    lower(p.address) || '|' || fields.field || '|' ||
    coalesce(to_jsonb(p) ->> fields.field, '') || '|' ||
    coalesce(nullif(p.source, ''), 'legacy_property_row') || '|' ||
    lower(p.address),
    'sha256'
  ), 'hex')
from properties p
cross join lateral unnest(array[
  'price', 'status', 'beds', 'baths', 'sqft', 'property_type',
  'neighborhood', 'city', 'state', 'zip', 'features',
  'utilities_included', 'appliances_included', 'parking', 'pet_policy',
  'deposit', 'fees', 'lease_terms', 'available_date', 'days_on_market',
  'tax_assessment', 'hoa_fee', 'year_built'
]) as fields(field)
where p.address <> ''
  and coalesce(to_jsonb(p) ->> fields.field, '') <> ''
on conflict (client_id, property_address, field, source_name, raw_hash)
do nothing;

create table if not exists scheduling_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  idempotency_key text not null,
  channel text not null,
  thread_ref text not null default '',
  status text not null default 'requested'
    check (status in (
      'requested', 'availability_checked', 'slot_selected',
      'confirmation_pending', 'confirmed', 'declined', 'expired'
    )),
  requested_start timestamptz not null,
  requested_end timestamptz not null,
  timezone text not null,
  property_address text not null default '',
  appointment_type text not null default 'showing',
  contact_hash text not null,
  provider text not null default '',
  provider_event_id text not null default '',
  provider_receipt jsonb not null default '{}'::jsonb,
  receipt_verified_at timestamptz,
  error_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, idempotency_key),
  check (requested_end > requested_start),
  check (length(idempotency_key) = 64),
  check (length(contact_hash) = 64),
  check (jsonb_typeof(provider_receipt) = 'object'),
  check (
    status <> 'confirmed'
    or (
      provider_event_id <> ''
      and receipt_verified_at is not null
      and provider_receipt ->> 'readBackVerified' = 'true'
    )
  )
);

create index if not exists scheduling_requests_pending_idx
  on scheduling_requests (client_id, status, created_at)
  where status in ('requested', 'availability_checked', 'slot_selected', 'confirmation_pending');
create index if not exists scheduling_requests_thread_idx
  on scheduling_requests (client_id, thread_ref, created_at desc);
