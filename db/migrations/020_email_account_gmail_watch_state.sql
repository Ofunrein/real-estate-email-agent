alter table if exists email_accounts
  add column if not exists gmail_watch_history_id text not null default '',
  add column if not exists gmail_watch_expiration timestamptz,
  add column if not exists gmail_watch_renewed_at timestamptz;

create index if not exists email_accounts_gmail_watch_expiration_idx
  on email_accounts (provider, status, gmail_watch_expiration);
