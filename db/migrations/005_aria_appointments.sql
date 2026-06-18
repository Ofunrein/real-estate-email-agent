-- Shared appointment source of truth for Aria, Theo, Iris, and Olivia.
create table if not exists appointments (
  id                  uuid primary key default gen_random_uuid(),
  client_id           text not null default current_setting('app.client_id', true),
  caller_phone        text not null,
  caller_name         text not null default '',
  caller_email        text not null default '',
  appointment_type    text not null default 'showing',
  property_address    text not null default '',
  scheduled_at        timestamptz not null,
  scheduled_at_local  text not null default '',
  duration_minutes    integer not null default 30,
  status              text not null default 'confirmed',
  ghl_event_id        text not null default '',
  google_event_id     text not null default '',
  booked_via_channel  text not null default '',
  call_id             text not null default '',
  notes               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists appointments_caller_phone_idx
  on appointments (client_id, caller_phone);

create index if not exists appointments_scheduled_at_idx
  on appointments (client_id, scheduled_at);

create index if not exists appointments_status_idx
  on appointments (client_id, status);
