-- Preserve the outreach status vocabulary that actually exists in the source data.
--
-- 033_demo_ownership.sql asserted `check (status in ('draft', 'sent'))` for
-- demo_outreach_drafts, taken from the column default and from what lumenosis-site's code
-- writes. The live Turso corpus disagrees: all nine existing drafts are 'scheduled', a
-- state written before the current code path existed. The migration is a preservation
-- contract, so the schema widens to fit the data rather than the data being rewritten to
-- fit the schema — rewriting it would destroy the distinction between a draft that was
-- never queued and one that was.
--
-- Ordering semantics, unchanged by this migration: 'draft' and 'scheduled' are both
-- pre-send states and 'sent' is terminal. lib/demo-admin-service.ts treats both pre-send
-- states as sendable and continues to make the transition to 'sent' idempotent, so a
-- replayed send cannot double-deliver.
--
-- Idempotent: the constraint is dropped by name and re-added, so re-application converges.

alter table demo_outreach_drafts
  drop constraint if exists demo_outreach_drafts_status_check;

alter table demo_outreach_drafts
  add constraint demo_outreach_drafts_status_check
  check (status in ('draft', 'scheduled', 'sent'));
