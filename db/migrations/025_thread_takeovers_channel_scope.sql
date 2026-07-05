-- Scope active takeover state by channel so shared phone/thread refs do not pause unrelated channels.
drop index if exists idx_thread_takeovers_active;

create unique index if not exists idx_thread_takeovers_active_channel
  on thread_takeovers(client_id, channel, thread_ref)
  where is_active = true;

create index if not exists idx_thread_takeovers_lookup_channel
  on thread_takeovers(client_id, channel, thread_ref);
