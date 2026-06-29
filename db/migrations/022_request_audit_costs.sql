alter table request_audit_events
  add column if not exists cost_usd numeric(12, 8) not null default 0,
  add column if not exists cost_service text not null default '',
  add column if not exists cost_units jsonb not null default '{}'::jsonb;

create index if not exists request_audit_events_cost_idx
  on request_audit_events (client_id, created_at desc)
  where cost_usd > 0;
