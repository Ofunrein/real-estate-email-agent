-- Mailbox-scoped Gmail thread ownership metadata.
alter table conversation_events
  add column if not exists mailbox_email text default '',
  add column if not exists gmail_thread_id text default '',
  add column if not exists gmail_message_id text default '',
  add column if not exists thread_status text default '';

create table if not exists thread_links (
  id bigserial primary key,
  client_id text not null references clients(id) on delete cascade,
  thread_ref text not null,
  channel text not null,
  mailbox_email text not null default '',
  gmail_thread_id text not null default '',
  gmail_message_id text not null default '',
  thread_status text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, thread_ref, channel)
);

create index if not exists idx_thread_links_client_mailbox
  on thread_links (client_id, mailbox_email);
