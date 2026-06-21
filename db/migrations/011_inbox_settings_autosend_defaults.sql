-- Default new inboxes to live auto-send. Preserve rows that have already been customized.
alter table inbox_settings alter column draft_first set default false;
alter table inbox_settings alter column auto_send_email set default true;
alter table inbox_settings alter column auto_send_sms set default true;
alter table inbox_settings alter column auto_send_whatsapp set default true;
alter table inbox_settings alter column auto_send_messenger set default true;
alter table inbox_settings alter column auto_send_instagram set default true;
alter table inbox_settings alter column auto_send_website_chat set default true;

update inbox_settings
   set draft_first = false,
       auto_send_email = true,
       auto_send_sms = true,
       auto_send_whatsapp = true,
       auto_send_messenger = true,
       auto_send_instagram = true,
       auto_send_website_chat = true,
       channels_enabled = channels_enabled
         || '{"email": true, "messenger": true, "instagram": true}'::jsonb,
       updated_at = now()
 where draft_first = true
   and auto_send_email = false
   and auto_send_sms = false
   and auto_send_whatsapp = false
   and auto_send_messenger = false
   and auto_send_instagram = false
   and auto_send_website_chat = false;
