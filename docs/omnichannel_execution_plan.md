# Omnichannel Execution Plan

Source PRD: [omnichannel_front_desk_ai_agent_PRD.md](./omnichannel_front_desk_ai_agent_PRD.md)

This is the repo-aligned build plan for the managed Lumenosis front-desk implementation. The PRD describes the product. This document defines what we actually build first in this codebase, what stays unchanged, what uses Composio, and how work gets validated.

## Product Decision

Lumenosis is a managed AI implementation service, not a self-serve SaaS. Clients should not configure raw API credentials unless the channel requires it. The operator-facing dashboard should expose connection state, selected accounts, channel availability, human takeover, and review queues. The backend owns the real routing.

## Channel Ownership

| Channel | V1 owner | Reason |
| --- | --- | --- |
| Email / Gmail | Composio + existing Gmail OAuth | Already wired for hosted connection and polling. Keep dashboard login separate from connected mailbox. |
| SMS | Twilio direct | Already live, phone-number-based, 10DLC-sensitive. Do not replace with Composio. |
| Voice | Vapi direct | Already live and owns purchased numbers, recordings, transcripts, and outbound call flow. Do not replace with Composio. |
| Instagram DMs | Composio auth + Instagram toolkit, Meta webhook or ManyChat route | Composio supports Instagram Business/Creator account OAuth and DM tools. Meta policy still controls permissions and the 24-hour window. |
| Facebook Messenger | Composio auth + Facebook toolkit, Meta webhook or ManyChat route | Composio supports Facebook Pages and message tools. Page selection and app review still matter. |
| WhatsApp | Existing Meta Cloud/Twilio WhatsApp first, Composio optional | WhatsApp Business setup, phone-number registration, templates, and verification remain platform-level. Composio can help once a client has a usable WABA. |
| CRM imports | Composio preferred where deep, direct adapters where needed, CSV fallback always | Matches Lead Reopen workload. |
| iMessage | Out of V1 | No public API. Only future relay options. |
| Voice cloning / STT widget | Out of V1 core | Useful, but not required for account connection and lead handling reliability. |

## Current Repo State

Already built or partially built:

- Shared inbox data model and dashboard tabs for email, SMS, voice, Instagram, Messenger, WhatsApp, website, properties, and Lead Reopen.
- Lead Reopen remains visible and now exposes a campaign review surface before activation: eligible, needs review, blocked, duplicate counts, no auto-send on import, and activation locked until reviewed.
- SMS via Twilio: inbound/outbound, media logging, handoff alerts, call-lead escalation, and shared Iris reply logic.
- Voice via Vapi: inbound/outbound calls, live status panel, recordings, transcript parsing, and cross-channel caller context.
- WhatsApp direct Meta Cloud route: inbound webhook verification, signature verification, message parsing, direct send, media send, and shared Iris reply logic.
- ManyChat social router: dynamic block route for Instagram/Messenger, real-estate intent guard, property lookup, media replies, and ManyChat setup docs/scripts.
- Composio SDK dependency and Gmail connect helper.
- Composio direct-send helper for Instagram and Messenger behind environment configuration. It is not the default sender until each client has a verified connected account, selected asset, and smoke test.
- Lead Reopen import pipeline with CSV, Google Sheets, CRM adapter pull, and Composio import hook.
- Dashboard thread surfaces for Instagram, Messenger, WhatsApp, and Website now share the SMS-style reader, category filters, recent-activity deep links, takeover composer, and latest-message scroll behavior.
- Human takeover composer supports paste/upload attachments through the existing thread upload route and passes media URLs into manual replies for channels that can send media.

Main gaps:

- No generic channel connection registry for client-selected Instagram/Facebook/WhatsApp accounts.
- No dashboard UI for selecting which connected Page, Instagram Business account, WhatsApp number, or CRM account each client should use.
- No generic Composio connect endpoint beyond Gmail and CRM import env configuration.
- Social direct mode is partially unified at the manual-send helper level, but ManyChat remains the practical Instagram/Messenger sender path until direct Composio/Meta smoke tests pass.
- WhatsApp direct mode exists, but Composio WhatsApp is not abstracted behind the same sender interface.
- Deployment runbook does not yet show per-client social account connection, webhook subscription, and E2E smoke tests.
- Runtime file uploads still need durable object storage for production scale; the current composer uses the existing local upload route.

## V1 Build Target

Ship a production-grade connection and routing layer without disrupting SMS/Voice:

1. Add a `channel_connections` store scoped by `client_id`.
2. Add Composio connection initiation for `instagram`, `facebook`, `whatsapp`, and CRM-capable toolkits.
3. Add post-connect asset discovery:
   - Instagram: connected IG Business/Creator accounts, usernames, IDs.
   - Facebook: managed Pages, page IDs, page names.
   - WhatsApp: WABA IDs, phone number IDs, display numbers, template status.
   - CRM: connected account ID, tool slug, import path.
4. Add dashboard Settings connection cards:
   - Connect / reconnect.
   - Select active account/page/number.
   - Show health: connected, needs review, webhook missing, app review pending, token expired.
   - Keep existing channel availability toggles.
5. Add a channel sender interface:
   - `sendSocialMessage(channel, thread, body, media)`.
   - Implement ManyChat sender first for routed flows.
   - Add Composio Instagram/Facebook sender behind a feature flag.
   - Keep direct Meta WhatsApp sender as default; add Composio WhatsApp sender behind a feature flag.
6. Add social webhook intake normalization:
   - Direct Meta webhook payloads and ManyChat payloads both become `recordChannelInteraction`.
   - All threads keep the same Iris memory, takeover, draft-first, categories, and activity feed behavior.
7. Add deployment checks:
   - Connection exists.
   - Selected asset exists.
   - Webhook verified.
   - Test inbound logged.
   - Test reply generated or drafted.
   - CRM writeback path configured or intentionally disabled.

## Data Model

Use raw SQL migrations and the existing `pg` / Neon pattern. Do not introduce Prisma or Drizzle.

Proposed table:

```sql
create table if not exists channel_connections (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  channel text not null,
  provider text not null,
  external_user_id text not null default '',
  auth_config_id text not null default '',
  connected_account_id text not null default '',
  selected_asset_id text not null default '',
  selected_asset_name text not null default '',
  selected_asset_type text not null default '',
  status text not null default 'needs_config',
  health_reason text not null default '',
  webhook_status text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, channel, provider, selected_asset_id)
);
```

Minimum metadata fields:

- `toolkit`
- `composio_user_id`
- `scopes`
- `expires_at`
- `last_health_check_at`
- `app_review_status`
- `messaging_window_policy`
- `template_count`
- `webhook_subscription_id`

## Connection UX

Settings should have a `Connections` section separate from `Channel availability`.

Per card:

- Status pill: `Connected`, `Needs setup`, `Needs review`, `Webhook missing`, `Token expired`.
- Primary action: `Connect`, `Reconnect`, or `Change`.
- Account selector: shows connected account/page/number options after OAuth.
- Health detail: one sentence with the next required step.

Suggested cards:

- Gmail inbox
- Instagram DMs
- Facebook Messenger
- WhatsApp Business
- CRM import/writeback
- Slack alerts

SMS and Voice should show provisioned state, not Composio connect:

- SMS: Twilio number, 10DLC status, webhook status.
- Voice: Vapi number, assistant ID, webhook status.

## Composio Account Selection

Use Composio for the operator-friendly connect flow wherever it gives enough account depth. The UX must not stop at `connected`; it must let the operator select the exact asset that should receive and send messages.

Required behavior:

1. Operator clicks `Connect` for Instagram, Facebook/Messenger, WhatsApp, or CRM.
2. Backend creates a Composio connect link for that channel toolkit/auth config.
3. After callback, backend stores `connected_account_id`.
4. Backend runs asset discovery for that connection.
5. Operator selects one active asset:
   - Instagram: specific Instagram Business/Creator account.
   - Messenger: specific Facebook Page.
   - WhatsApp: specific WABA phone number, if Composio is used.
   - CRM: specific CRM account/import tool.
6. Selected asset is saved to `channel_connections.selected_asset_id`.
7. Channel stays disabled or draft-only until a smoke test proves inbound logging and outbound sending for that selected asset.

Important distinction:

- Composio can own account connection and account selection.
- ManyChat, direct Meta, Twilio, or Composio can own message transport.
- Only one sender-of-record can be active for a thread/channel at a time.

For Instagram and Messenger V1:

- Connect/select through Composio when available.
- Continue ManyChat routing for clients already running ManyChat automations.
- Enable direct Composio/Meta send only behind a feature flag after app review and a real send/read smoke test.

## Channel Routing

Do not make separate brains per channel. Use Iris as the single decision layer.

Inbound flow:

1. Channel webhook receives payload.
2. Normalize into `ChannelIngestInput`.
3. Persist inbound event.
4. Load lead memory, recent events, takeover state, channel settings, and property context.
5. Generate Iris reply.
6. If draft-first or channel disabled: save draft.
7. Else send through the channel sender.
8. Persist outbound event.
9. Trigger hot-lead/handoff notification if needed.

Outbound sender order:

- SMS: Twilio direct.
- Voice: Vapi direct.
- WhatsApp: direct Meta Cloud first, Twilio WhatsApp fallback, Composio WhatsApp optional.
- Instagram: ManyChat dynamic block first for managed campaigns, Composio Instagram direct sender optional after Meta app review.
- Messenger: ManyChat dynamic block first for managed campaigns, Composio Facebook direct sender optional after Meta app review.

Sender-of-record rules:

- A ManyChat-routed Instagram/Messenger thread cannot also direct-send through Composio/Meta for the same reply.
- A direct Composio/Meta thread cannot also return a ManyChat Dynamic Block response for the same reply.
- A WhatsApp thread records which provider sent the last outbound reply: `meta_cloud`, `twilio_whatsapp`, or `composio_whatsapp`.
- Every outbound send must persist an outbound `conversation_events` row for the channel that the user actually sees.

## WhatsApp Decision

Keep WhatsApp direct for V1.

Reason:

- WhatsApp requires a Business account, business phone number, template setup, webhook subscription, and policy-compliant sessions regardless of Composio.
- The repo already has direct Meta Cloud support in `app/api/webhooks/theo-whatsapp/route.ts` and `lib/metaWhatsapp.ts`.
- Composio WhatsApp should be added as a secondary adapter for clients who connect WABA through Composio, not as a blocker for existing direct setup.

## ManyChat Decision

Keep ManyChat as the lowest-risk Instagram/Messenger production path for clients already using it.

Reason:

- Existing docs and route already support ManyChat dynamic blocks.
- It avoids fighting the client's existing automations.
- It lets Iris operate only on routed real-estate intent flows.

Direct Composio/Meta social messaging becomes the next path when:

- Client has the required Meta assets.
- App permissions are approved for external users.
- We have verified send/read/webhook with the selected Page/IG account.

## Workstreams

### A. Connection Registry

Owner: backend.

Files:

- `lib/database.ts`
- `scripts/setup-neon.sh`
- `lib/channelConnections.ts`
- `app/api/settings/channel-connections/route.ts`

Deliverables:

- `channel_connections` CRUD.
- Health status helpers.
- Tests for client scoping and duplicate prevention.

### B. Composio Connect Layer

Owner: backend.

Files:

- `lib/composioConnection.ts`
- `app/api/settings/channel-connections/connect/route.ts`
- `app/api/settings/channel-connections/callback/route.ts`
- `app/api/settings/channel-connections/assets/route.ts`

Deliverables:

- Generic connect-link creation by channel/toolkit.
- Store `connected_account_id`.
- Asset discovery for Instagram/Facebook/WhatsApp where supported.
- Clear fallback message when Composio cannot provide enough depth.

### C. Settings UI

Owner: frontend.

Files:

- `components/inbox-mui/components/SettingsDrawer.tsx`
- `components/inbox-mui/data/inboxData.ts`
- New `components/inbox-mui/components/ConnectionCards.tsx`

Deliverables:

- Responsive connection grid.
- Select active social account/page/number.
- Preserve mobile/zoom constraints.
- No card overflow.

### D. Social Sender Interface

Owner: backend.

Files:

- `lib/socialSender.ts`
- `lib/manychatSocial.ts`
- `app/api/webhooks/theo-social-router/route.ts`
- `lib/composioSocial.ts`

Deliverables:

- One sender contract for Instagram/Messenger.
- ManyChat remains default.
- Composio direct sender environment-configured and feature-flagged.
- Prevent double-send with takeover and draft-first rules.

### E. WhatsApp Adapter Split

Owner: backend.

Files:

- `lib/metaWhatsapp.ts`
- `app/api/webhooks/theo-whatsapp/route.ts`
- Optional `lib/composioWhatsapp.ts`

Deliverables:

- Keep direct Meta Cloud as default.
- Add adapter selection: `WHATSAPP_PROVIDER=meta|twilio|composio`.
- Persist selected WABA/phone metadata in `channel_connections`.

### F. Deployment + E2E Runbook

Owner: QA/deployment.

Files:

- `docs/omnichannel_front_desk_ai_agent_PRD.md`
- `docs/omnichannel_execution_plan.md`
- `docs/hosted-client-onboarding.md`
- Scripts under `scripts/`

Deliverables:

- Per-channel setup checklist.
- Production smoke test commands.
- Dashboard verification checklist.
- Rollback plan.

## First Production Blockers

These must be closed before enabling new social auto-send:

- Add account ownership and audit fields for every connected social account.
- Encrypt or externally reference tokens; never store raw social tokens in dashboard-facing tables.
- Add idempotency keys for inbound event IDs and outbound send IDs.
- Finish human takeover lifecycle for handback and manual sends.
- Enforce platform policy windows:
  - SMS STOP/START/HELP.
  - Instagram/Messenger 24-hour messaging window.
  - WhatsApp template requirement outside the customer-service window.
- Keep iMessage relay and voice cloning out of V1.
- Fish Audio voice cloning, TTS, and STT are supported as a later voice-note utility, not as the V1 message transport. Vapi remains the voice-call transport and Twilio/Meta/Composio remain message transports.
- Keep CRM writes to contact upsert and internal activity mirror first. Pipeline moves and drips require a separate reviewed rollout.

## Subagent Development Plan

Use subagents only on disjoint work:

1. Backend registry worker:
   - Owns `channel_connections`, API routes, tests.
   - No UI edits.
2. Composio worker:
   - Owns generic connect and asset discovery.
   - No database schema edits except through registry helpers.
3. UI worker:
   - Owns settings connection cards and responsive layout.
   - No webhook edits.
4. Social/WhatsApp adapter worker:
   - Owns sender interfaces and provider selection.
   - No settings UI edits.
5. QA reviewer:
   - Owns test matrix, failure cases, and deployment gate review.
   - Read-only until integration review.

Integration sequence:

1. Merge registry first.
2. Merge Composio connect layer.
3. Merge UI against live registry endpoints.
4. Merge sender adapters.
5. Run full targeted tests and production build.
6. Deploy, then run real channel smoke tests.

## Test Matrix

Required before deploy:

- `npm run lint`
- `npm run build`
- `node --import tsx --test tests/ts/channelIngest.test.ts`
- `node --import tsx --test tests/ts/theoSocialRouter.test.ts`
- `node --import tsx --test tests/ts/metaWhatsapp.test.ts`
- `node --import tsx --test tests/ts/manychatSocial.test.ts`
- `node --import tsx --test tests/ts/leadImport.test.ts`

Manual E2E gates:

- Connect Instagram/Facebook/WhatsApp account.
- Select a Page/IG/WABA asset.
- Confirm selected asset survives refresh.
- Send inbound test message.
- Confirm dashboard event appears under the correct channel.
- Confirm Iris drafts or sends depending on channel settings.
- Confirm no duplicate reply when ManyChat is active.
- Confirm human takeover blocks automation.
- Confirm hot lead/handoff alert fires.
- Confirm CRM log/writeback if configured.

## Production Readiness Gates

- Every channel has a selected account or is explicitly disabled.
- SMS and Voice show provisioned phone/assistant state, not Composio prompts.
- Meta app review status is visible for Instagram/Messenger direct mode.
- WhatsApp number/template status is visible.
- Auto-send defaults are explicit per channel.
- Draft-first mode works for every sender adapter.
- Activity feed deep-links to the exact event.
- Lead identity stitches by phone/email/social user id without duplicate lead memory.
- All channel writes are client-scoped.

## External Documentation Checked

- Composio Instagram toolkit: https://docs.composio.dev/toolkits/instagram
- Composio Facebook toolkit: https://docs.composio.dev/toolkits/facebook
- Composio WhatsApp toolkit: https://docs.composio.dev/toolkits/whatsapp
- Composio white-label authentication: https://docs.composio.dev/docs/authentication
- Meta Instagram Messaging: https://developers.facebook.com/documentation/business-messaging/instagram-messaging
- Meta Messenger send messages and 24-hour window: https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages
- Meta WhatsApp Cloud API setup: https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
