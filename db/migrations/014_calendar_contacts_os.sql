create extension if not exists pgcrypto;

-- Mauro/Lumenosis Calendar + Contacts OS.
-- Existing appointments and lead_memory stay valid; these tables add normalized
-- contacts, calendars, provider refs, sync state, and timeline links around them.

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  client_id text not null default current_setting('app.client_id', true),
  caller_phone text not null,
  caller_name text not null default '',
  caller_email text not null default '',
  appointment_type text not null default 'showing',
  property_address text not null default '',
  scheduled_at timestamptz not null,
  scheduled_at_local text not null default '',
  duration_minutes integer not null default 30,
  status text not null default 'confirmed',
  ghl_event_id text not null default '',
  google_event_id text not null default '',
  booked_via_channel text not null default '',
  call_id text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists calendar_provider_connections (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  user_id text not null default '',
  provider text not null,
  provider_account_id text not null default '',
  composio_connected_account_id text not null default '',
  display_name text not null default '',
  email text not null default '',
  status text not null default 'disconnected',
  metadata jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider, provider_account_id, composio_connected_account_id)
);

create table if not exists calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  connection_id uuid references calendar_provider_connections(id) on delete set null,
  provider text not null default 'mauro',
  provider_account_id text not null default '',
  display_name text not null default '',
  email text not null default '',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists calendars (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  account_id uuid references calendar_accounts(id) on delete set null,
  owner_user_id text not null default '',
  name text not null,
  description text not null default '',
  color text not null default '#6366f1',
  timezone text not null default 'America/Chicago',
  duration_default_minutes integer not null default 30,
  slot_interval_minutes integer not null default 30,
  buffer_before_minutes integer not null default 0,
  buffer_after_minutes integer not null default 0,
  minimum_notice_minutes integer not null default 60,
  maximum_range_days integer not null default 30,
  booking_link_slug text not null default '',
  confirmation_behavior text not null default 'auto_confirm',
  cancellation_behavior text not null default 'allow_cancel',
  reschedule_behavior text not null default 'allow_reschedule',
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists calendar_groups (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  name text not null,
  description text not null default '',
  color text not null default '#6366f1',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists calendar_group_members (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  group_id uuid not null references calendar_groups(id) on delete cascade,
  calendar_id uuid not null references calendars(id) on delete cascade,
  role text not null default 'member',
  unique (client_id, group_id, calendar_id)
);

create table if not exists calendar_availability_rules (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  calendar_id uuid references calendars(id) on delete cascade,
  user_id text not null default '',
  weekday integer not null,
  start_time text not null,
  end_time text not null,
  timezone text not null default 'America/Chicago',
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  check (weekday between 0 and 6)
);

create table if not exists calendar_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  calendar_id uuid references calendars(id) on delete cascade,
  user_id text not null default '',
  date text not null,
  start_time text not null default '',
  end_time text not null default '',
  blocked boolean not null default true,
  reason text not null default '',
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists calendar_booking_types (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  calendar_id uuid references calendars(id) on delete cascade,
  name text not null,
  duration_minutes integer not null default 30,
  location_type text not null default 'phone',
  description text not null default '',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table appointments
  add column if not exists title text not null default '',
  add column if not exists description text not null default '',
  add column if not exists timezone text not null default 'America/Chicago',
  add column if not exists assigned_user_id text not null default '',
  add column if not exists calendar_id uuid,
  add column if not exists calendar_group_id uuid,
  add column if not exists contact_id uuid,
  add column if not exists opportunity_id text not null default '',
  add column if not exists source text not null default 'manual',
  add column if not exists location_type text not null default 'phone',
  add column if not exists location_value text not null default '',
  add column if not exists internal_notes text not null default '',
  add column if not exists created_by text not null default '',
  add column if not exists updated_by text not null default '';

create table if not exists appointment_attendees (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  role text not null default 'attendee',
  status text not null default 'needs_action'
);

create table if not exists appointment_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  contact_id uuid not null,
  role text not null default 'primary',
  unique (client_id, appointment_id, contact_id)
);

create table if not exists appointment_external_refs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  provider text not null,
  provider_account_id text not null default '',
  external_calendar_id text not null default '',
  external_event_id text not null,
  last_synced_hash text not null default '',
  last_synced_at timestamptz,
  sync_status text not null default 'pending',
  last_sync_error text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  unique (client_id, provider, provider_account_id, external_calendar_id, external_event_id)
);

create table if not exists calendar_sync_states (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  connection_id uuid references calendar_provider_connections(id) on delete cascade,
  provider text not null,
  external_calendar_id text not null default '',
  sync_cursor text not null default '',
  sync_cursor_type text not null default '',
  sync_range_start timestamptz,
  sync_range_end timestamptz,
  status text not null default 'idle',
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_error text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists calendar_sync_logs (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  provider text not null,
  connection_id uuid,
  external_calendar_id text not null default '',
  sync_type text not null,
  status text not null,
  items_read integer not null default 0,
  items_written integer not null default 0,
  error text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists calendar_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  provider text not null,
  connection_id uuid,
  external_calendar_id text not null default '',
  external_subscription_id text not null default '',
  resource_id text not null default '',
  expires_at timestamptz,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists booking_holds (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  calendar_id uuid references calendars(id) on delete cascade,
  contact_id uuid,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'held',
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  name text not null,
  domain text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  full_name text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  company text not null default '',
  lead_status text not null default 'new',
  source text not null default '',
  lead_source text not null default '',
  assigned_user_id text not null default '',
  property_interest text not null default '',
  buyer_seller_renter text not null default '',
  budget text not null default '',
  timeline text not null default '',
  do_not_contact boolean not null default false,
  raw_provider_payload jsonb not null default '{}'::jsonb,
  custom_fields jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contact_identities (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  identity_type text not null,
  identity_value text not null,
  confidence numeric not null default 1,
  source text not null default '',
  unique (client_id, identity_type, identity_value)
);

create table if not exists contact_emails (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  email text not null,
  label text not null default 'primary',
  is_primary boolean not null default false
);

create table if not exists contact_phones (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  phone text not null,
  normalized_phone text not null,
  label text not null default 'primary',
  is_primary boolean not null default false,
  sms_consent text not null default '',
  call_consent text not null default '',
  unique (client_id, normalized_phone)
);

create table if not exists contact_addresses (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  address text not null default '',
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  label text not null default ''
);

create table if not exists contact_company_links (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  role text not null default '',
  unique (client_id, contact_id, company_id)
);

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  slug text not null,
  label text not null,
  color text not null default '#6366f1',
  unique (client_id, slug)
);

create table if not exists contact_tags (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  unique (client_id, contact_id, tag_id)
);

create table if not exists contact_notes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  body text not null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists contact_custom_fields (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  key text not null,
  label text not null,
  field_type text not null default 'text',
  unique (client_id, key)
);

create table if not exists contact_custom_field_values (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  field_id uuid not null references contact_custom_fields(id) on delete cascade,
  value text not null default '',
  unique (client_id, contact_id, field_id)
);

create table if not exists contact_external_refs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  provider text not null,
  provider_account_id text not null default '',
  external_contact_id text not null,
  last_synced_hash text not null default '',
  last_synced_at timestamptz,
  sync_status text not null default 'pending',
  last_sync_error text not null default '',
  raw_provider_payload jsonb not null default '{}'::jsonb,
  unique (client_id, provider, provider_account_id, external_contact_id)
);

create table if not exists contact_sync_states (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  provider text not null,
  connection_id uuid,
  sync_cursor text not null default '',
  sync_cursor_type text not null default '',
  status text not null default 'idle',
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_error text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists contact_sync_logs (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  provider text not null,
  connection_id uuid,
  sync_type text not null,
  status text not null,
  items_read integer not null default 0,
  items_written integer not null default 0,
  error text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists contact_timeline_events (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references clients(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  event_type text not null,
  event_at timestamptz not null default now(),
  title text not null default '',
  body text not null default '',
  source text not null default '',
  source_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists calendars_client_active_idx on calendars (client_id, archived_at);
create unique index if not exists calendar_sync_states_unique_idx
  on calendar_sync_states (client_id, provider, external_calendar_id, coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists appointments_client_calendar_idx on appointments (client_id, calendar_id, scheduled_at);
create index if not exists appointments_client_contact_idx on appointments (client_id, contact_id, scheduled_at desc);
create index if not exists appointment_contacts_contact_idx on appointment_contacts (client_id, contact_id);
create index if not exists appointment_external_refs_appointment_idx on appointment_external_refs (client_id, appointment_id);
create index if not exists booking_holds_client_calendar_idx on booking_holds (client_id, calendar_id, start_at, end_at);
create unique index if not exists companies_client_lower_name_idx on companies (client_id, lower(name));
create index if not exists contacts_client_recent_idx on contacts (client_id, deleted_at, coalesce(last_activity_at, updated_at) desc);
create index if not exists contacts_client_status_idx on contacts (client_id, lead_status);
create unique index if not exists contact_emails_client_lower_email_idx on contact_emails (client_id, lower(email));
create index if not exists contact_notes_contact_idx on contact_notes (client_id, contact_id, created_at desc);
create unique index if not exists contact_sync_states_unique_idx
  on contact_sync_states (client_id, provider, coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists contact_timeline_contact_idx on contact_timeline_events (client_id, contact_id, event_at desc);
