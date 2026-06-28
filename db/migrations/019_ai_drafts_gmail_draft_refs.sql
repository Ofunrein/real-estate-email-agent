alter table if exists ai_drafts
  add column if not exists gmail_draft_id text not null default '',
  add column if not exists gmail_message_id text not null default '',
  add column if not exists gmail_thread_id text not null default '',
  add column if not exists gmail_mailbox_email text not null default '',
  add column if not exists gmail_draft_synced_at timestamptz;
