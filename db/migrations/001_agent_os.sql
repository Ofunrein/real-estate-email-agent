create table if not exists clients (
  id text primary key,
  name text not null,
  google_sheet_id text,
  default_owner_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists properties (
  client_id text not null references clients(id) on delete cascade,
  address text not null,
  price text default '',
  beds text default '',
  baths text default '',
  city text default '',
  state text default '',
  zip text default '',
  description text default '',
  neighborhood text default '',
  property_type text default '',
  features text default '',
  days_on_market text default '',
  photo_url text default '',
  sqft text default '',
  year_built text default '',
  status text default '',
  listing_url text default '',
  agent_name text default '',
  agent_email text default '',
utilities_included text default '',
appliances_included text default '',
parking text default '',
pet_policy text default '',
deposit text default '',
fees text default '',
lease_terms text default '',
floor text default '',
unit_number text default '',
available_date text default '',
showing_instructions text default '',
negotiability_notes text default '',
listing_agent_name text default '',
listing_agent_phone text default '',
  source text not null default 'sheets',
  updated_at timestamptz not null default now(),
  primary key (client_id, address)
);

create table if not exists lead_memory (
  client_id text not null references clients(id) on delete cascade,
  email text not null default '',
  phone text not null default '',
  full_name text not null default '',
  lead_source text default '',
  source_detail text default '',
  lead_role text default '',
  intent text default '',
  property_interest text default '',
  budget text default '',
  area text default '',
  timeline text default '',
  preferred_channel text default '',
  sms_consent text default '',
  call_consent text default '',
  last_channel text default '',
  last_ai_touch_at text default '',
  assigned_owner text default '',
  handoff_status text default '',
  handoff_reason text default '',
  next_action text default '',
  summary text default '',
  updated_at timestamptz not null default now(),
  primary key (client_id, email, phone, full_name)
);

create table if not exists conversation_events (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  event_at text default '',
  channel text default '',
  direction text default '',
  email text default '',
  phone text default '',
  full_name text default '',
  source text default '',
  thread_ref text default '',
  agent_name text default '',
  human_owner text default '',
  event_type text default '',
  message_text text default '',
  summary text default '',
  transcript_url text default '',
  recording_url text default '',
  ai_action text default '',
  handoff_reason text default '',
  status text default '',
  created_at timestamptz not null default now()
);

create table if not exists email_style_examples (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  source_message_id text,
  category text default '',
  tone_tags text[] not null default '{}',
  redacted_excerpt text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_properties_client_city on properties(client_id, city);
create index if not exists idx_properties_client_zip on properties(client_id, zip);
create index if not exists idx_lead_memory_client_phone on lead_memory(client_id, phone);
create index if not exists idx_lead_memory_client_email on lead_memory(client_id, email);
create index if not exists idx_events_client_channel on conversation_events(client_id, channel);
create index if not exists idx_events_client_thread on conversation_events(client_id, thread_ref);
