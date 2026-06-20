-- Configurable Iris inbox categories, automation settings, drafts, and caches.
create table if not exists inbox_settings (
  client_id text primary key references clients(id) on delete cascade,
  draft_first boolean not null default true,
  auto_send_email boolean not null default false,
  auto_send_sms boolean not null default false,
  auto_send_whatsapp boolean not null default false,
  auto_send_messenger boolean not null default false,
  auto_send_instagram boolean not null default false,
  auto_send_website_chat boolean not null default false,
  channels_enabled jsonb not null default '{}'::jsonb,
  cache_status jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inbox_categories (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  slug text not null,
  name text not null,
  color text not null,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  gmail_label_id text not null default '',
  gmail_label_name text not null default '',
  auto_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, slug)
);

create table if not exists ai_drafts (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  thread_ref text not null,
  channel text not null,
  body text not null,
  category_slug text not null default '',
  confidence numeric not null default 0,
  reason text not null default '',
  next_action text not null default '',
  safe_to_auto_send boolean not null default false,
  needs_human boolean not null default false,
  model text not null default '',
  status text not null default 'draft',
  fingerprint text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_drafts_thread_active_idx
  on ai_drafts (client_id, thread_ref, channel)
  where status = 'draft';

create table if not exists thread_context_cache (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  thread_ref text not null,
  channel text not null,
  summary text not null default '',
  property_context jsonb not null default '[]'::jsonb,
  lead_memory jsonb not null default '{}'::jsonb,
  fingerprint text not null default '',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, thread_ref, channel)
);

create table if not exists gmail_label_cache (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  email_account text not null,
  category_slug text not null,
  label_id text not null,
  label_name text not null,
  color text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, email_account, category_slug)
);
