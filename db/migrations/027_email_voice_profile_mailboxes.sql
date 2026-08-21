alter table if exists email_style_examples
  add column if not exists mailbox_email text not null default '';

create index if not exists email_style_examples_voice_lookup_idx
  on email_style_examples (client_id, mailbox_email, category, created_at desc)
  where approved = true;

create unique index if not exists email_style_examples_source_mailbox_idx
  on email_style_examples (client_id, source_message_id, mailbox_email)
  where source_message_id is not null;
