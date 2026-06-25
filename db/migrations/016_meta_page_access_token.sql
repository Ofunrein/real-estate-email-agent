-- Add per-page access token storage to channel_connections.
-- Enables multi-tenant Facebook/Instagram pages with individual tokens
-- instead of relying on a single META_SOCIAL_PAGE_ACCESS_TOKEN env var.

alter table channel_connections
  add column if not exists page_access_token text not null default '',
  add column if not exists token_expires_at timestamptz;
