-- Contact suppression columns.
--
-- do_not_contact already exists (006) but nothing on the live send path read
-- it, and mergeNonEmpty could clear the free-text fields that stood in for it.
-- email_consent is new: an email unsubscribe had nowhere to land.
--
-- The partial index backs the suppression read on the reply-send hot path.

alter table lead_memory
  add column if not exists email_consent text not null default '';

create index if not exists lead_memory_suppressed_idx
  on lead_memory (client_id, phone, email)
  where do_not_contact = true;
