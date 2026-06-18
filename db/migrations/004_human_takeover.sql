-- 004_human_takeover.sql — per-thread human takeover state
create table if not exists thread_takeovers (
  id            bigserial primary key,
  client_id     text not null references clients(id) on delete cascade,
  thread_ref    text not null,
  channel       text not null,           -- 'sms' | 'whatsapp' | 'email'
  is_active     boolean not null default true,
  taken_by      text not null default 'owner',
  taken_at      timestamptz not null default now(),
  released_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- one active takeover per thread
create unique index if not exists idx_thread_takeovers_active
  on thread_takeovers(client_id, thread_ref)
  where is_active = true;

create index if not exists idx_thread_takeovers_lookup
  on thread_takeovers(client_id, thread_ref);
