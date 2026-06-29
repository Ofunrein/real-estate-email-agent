alter table email_accounts
  add column if not exists gmail_history_cursor_id text not null default '';

update email_accounts
   set gmail_history_cursor_id = gmail_watch_history_id
 where provider = 'gmail'
   and gmail_history_cursor_id = ''
   and gmail_watch_history_id <> '';
