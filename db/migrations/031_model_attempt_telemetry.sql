-- Additive only. Created by docs/audits/2026-09-model-routing/ — NOT applied to any remote
-- database as part of this audit (see prohibition #4 and 05-rollout.md). Reads/writes against this
-- table probe information_schema.columns first (lib/modelAttemptTelemetry.ts::hasTelemetryTable)
-- and no-op safely when the table is absent, matching the existing tableColumns() fallback pattern
-- in lib/database.ts.
--
-- One row per model ATTEMPT (not per successful result) — see lib/modelAttemptTelemetry.ts for the
-- writer and docs/audits/2026-09-model-routing/00-evidence-ledger.md §0.5 for why this is additive
-- to, not a replacement for, db/migrations/022_request_audit_costs.sql (a narrower, pre-existing
-- cost ledger).
create table if not exists model_attempt_telemetry (
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null,
  correlation_id text not null default '',
  client_id text not null default '',
  channel text not null default '',
  agent text not null default '',
  task_class text not null default '',
  routing_tier text not null default '',
  model_id text not null default '',
  reasoning_effort text not null default '',
  attempt_index integer not null default 0,
  is_fallback boolean not null default false,
  parent_attempt_id text,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  latency_ms integer,
  ttft_ms integer,
  outcome text not null default '',
  error_class text,
  cost_usd numeric(12, 6) not null default 0,
  -- Deliberately a hash, never the raw prompt/message body. See risk register #9 and
  -- lib/modelAttemptTelemetry.ts::redactForTelemetry.
  prompt_hash text not null default '',
  routing_reason text not null default '',
  human_review_flag boolean not null default false,
  prompt_version text not null default '',
  created_at timestamptz not null default now(),
  unique (attempt_id)
);

create index if not exists model_attempt_telemetry_correlation_idx
  on model_attempt_telemetry (correlation_id);
create index if not exists model_attempt_telemetry_client_created_idx
  on model_attempt_telemetry (client_id, created_at);
