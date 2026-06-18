-- Cross-channel qualification fields and call/appointment event metadata.
alter table lead_memory
  add column if not exists bedrooms text not null default '',
  add column if not exists bathrooms text not null default '',
  add column if not exists sell_before_buy text not null default '',
  add column if not exists lead_score integer not null default 0,
  add column if not exists appointment_count integer not null default 0,
  add column if not exists last_appointment_at timestamptz,
  add column if not exists do_not_contact boolean not null default false,
  add column if not exists whatsapp_consent text not null default '';

alter table conversation_events
  add column if not exists call_duration_seconds integer,
  add column if not exists appointment_id text,
  add column if not exists outcome_code text;

create index if not exists lead_memory_score_idx
  on lead_memory (client_id, lead_score desc);

create index if not exists lead_memory_last_touch_idx
  on lead_memory (client_id, last_ai_touch_at desc);
