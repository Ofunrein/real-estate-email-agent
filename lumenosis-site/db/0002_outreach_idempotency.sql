-- Additive send-idempotency support for demo outreach.
--
-- NOT APPLIED by this change. Apply is a separate, separately-approved action.
-- Additive only: a nullable column plus a unique index, no rewrite, no drop,
-- no down-migration required. Leaving it unapplied is safe: the send path is
-- already idempotent via the `status = 'draft'` guard; this column lets a caller
-- replay with a stable key across instances.

ALTER TABLE outreach_drafts ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_idempotency
  ON outreach_drafts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
