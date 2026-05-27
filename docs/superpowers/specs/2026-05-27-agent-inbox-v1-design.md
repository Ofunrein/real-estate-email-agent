# Agent Inbox V1 Design

## Purpose

Agent Inbox is the V1 monitoring surface for Lumenosis AI's real estate agents. It is not a CRM replacement and not a full admin dashboard. Its job is to let a client see what the AI is doing across channels: email, SMS, WhatsApp, voice, website chat, forms, CRM/router events, and human handoffs.

The editable data layer for V1 is one client Google Sheet workbook. The app reads and writes clean table rows in that workbook, then Agent Inbox renders those rows as readable lead profiles, conversation threads, channel views, and simple metrics.

## Product Shape

V1 has one core orchestration layer and four channel personalities:

- Iris: email agent. Longer, warmer, more emotionally aware, listing-aware.
- Theo: SMS and WhatsApp agent. Short, fast, consent-aware, conversational.
- Aria: voice agent. Handles call flow, spoken tone, interruptions, summaries, transfers, and call recordings.
- Olivia: website chat agent. Captures visitor intent, answers basic listing/service questions, and turns anonymous visitors into leads.

The personalities should not own separate memories. They share the same workbook tables through one Urban Mail/Lumenosis API layer.

## V1 Workbook

One client gets one Google Sheet workbook with three required tabs.

### `properties`

This is the existing property/listing table. It should continue to support automatic property enrichment and appends.

Core columns:

- `address`
- `price`
- `beds`
- `baths`
- `city`
- `state`
- `zip`
- `description`
- `neighborhood`
- `property_type`
- `features`
- `days_on_market`
- `photo_url`
- `sqft`
- `year_built`
- `status`
- `listing_url`
- `agent_name`
- `agent_email`

### `lead_memory`

One row per lead/person. This is the current state of the lead, not the full conversation history.

Core columns:

- `email`
- `phone`
- `full_name`
- `lead_source`
- `source_detail`
- `lead_role`
- `intent`
- `property_interest`
- `budget`
- `area`
- `timeline`
- `preferred_channel`
- `sms_consent`
- `call_consent`
- `last_channel`
- `last_ai_touch_at`
- `assigned_owner`
- `handoff_status`
- `handoff_reason`
- `next_action`
- `summary`

Lead matching order:

1. Match by normalized phone.
2. Match by normalized email.
3. If phone and email are missing, use name only as a weak fallback and mark the lead for review.

No visible `lead_id` is required in V1. Internally, code can derive a key from normalized phone or email.

### `conversation_events`

One row per interaction. This is the timeline and audit trail.

Core columns:

- `event_at`
- `channel`
- `direction`
- `email`
- `phone`
- `full_name`
- `source`
- `thread_ref`
- `agent_name`
- `human_owner`
- `event_type`
- `message_text`
- `summary`
- `transcript_url`
- `recording_url`
- `ai_action`
- `handoff_reason`
- `status`

Examples of event rows:

- Inbound email inquiry.
- Iris email reply.
- Theo SMS reply.
- WhatsApp message.
- Aria call transcript.
- Voice recording link.
- Website chat message from Olivia.
- CRM/router update.
- Human handoff.

## Agent Inbox UI

Agent Inbox is a conversation viewer and activity monitor.

It should have these main views:

- Overview: lead count, active conversations, hot leads, needs-human count, channel volume, recent failures.
- Email: email threads handled by Iris, including inbound email, AI reply, lead classification, and handoff status.
- SMS: SMS threads handled by Theo.
- WhatsApp: WhatsApp threads handled by Theo, separated from SMS at the UI/transport level.
- Voice: Aria calls with transcript, recording link, summary, transfer status, and outcome.
- Website Chat: Olivia chat sessions and captured lead details.
- Leads: table backed by `lead_memory`.
- Metrics: basic counts by source, channel, handoff status, appointment intent, opt-out, and response time.

The UI should look like actual conversation threads. The main user action is reading what happened, not editing every field. Edits stay mainly in Google Sheets and the client's CRM.

## SMS And WhatsApp

SMS and WhatsApp should be separate channel adapters but can share Theo's personality and logic.

Reason:

- SMS has TCPA consent and STOP handling.
- WhatsApp has platform-specific consent, templates, and delivery rules.
- Users expect separate tabs/filters.
- The AI tone can be similar, but transport rules are different.

Implementation framing:

- `channels/sms.py`: SMS adapter.
- `channels/whatsapp.py`: WhatsApp adapter.
- `personalities/theo.py`: shared text-message behavior.

## API Layer

Do not let every agent write directly to Sheets in a different format. V1 should introduce a small API/orchestration layer that all channel agents call.

Responsibilities:

- Normalize phone/email.
- Match existing leads.
- Update `lead_memory`.
- Append `conversation_events`.
- Read `properties`.
- Build handoff summaries.
- Apply routing rules.
- Track metrics.
- Return recent lead context to the channel agent.

This API may live in the current repo for V1, but it should be split into clear modules so it can later become its own service.

## Suggested Code Shape

Avoid one giant file. The current email agent can remain working while new code is separated by responsibility.

Suggested structure:

```text
agent.py
core/
  sheets_store.py
  lead_matching.py
  event_logger.py
  routing.py
  metrics.py
personalities/
  iris.py
  theo.py
  aria.py
  olivia.py
channels/
  email.py
  sms.py
  whatsapp.py
  voice.py
  website_chat.py
agent_inbox/
  app.py
  views/
```

For V1, feature flags decide which personalities/channels are enabled per client:

- `ENABLE_EMAIL_AGENT`
- `ENABLE_SMS_AGENT`
- `ENABLE_WHATSAPP_AGENT`
- `ENABLE_VOICE_AGENT`
- `ENABLE_WEBSITE_CHAT_AGENT`
- `ENABLE_AGENT_INBOX`

## Website Chat

The Lumenosis site already presents Olivia as the front desk chat agent. V1 should reserve Olivia as the fourth personality, but implementation can wait until after Agent Inbox and shared Sheets memory are stable.

Olivia should:

- Answer website visitor questions from approved knowledge and property data.
- Capture name, phone/email, and intent.
- Write or update `lead_memory`.
- Append website chat events to `conversation_events`.
- Escalate hot or sensitive leads.

## Metrics

Keep metrics simple and useful:

- Leads by source.
- Leads by channel.
- Active conversations.
- AI replies sent.
- Human handoffs.
- Handoff reasons.
- Response time.
- SMS/WhatsApp opt-outs.
- Voice calls answered.
- Voice calls transferred.
- Website chats captured.
- Property inquiries.
- Hidden opportunities detected.

## Compliance And Safety

V1 must preserve the existing guardrails:

- Do not invent listing facts.
- Ask one question at a time.
- Stop pushing after three clear no responses.
- Respect SMS opt-out and consent.
- Store call recording consent where voice is used.
- Escalate Fair Housing, legal, contract, mortgage-license, angry, privacy, and broker-approval issues.
- Summarize every human handoff.

## Build Order

1. Add/validate the three workbook tabs.
2. Extract shared Sheets helpers into `core/sheets_store.py`.
3. Add lead matching and event logging.
4. Make Iris/email write to `lead_memory` and `conversation_events`.
5. Build Agent Inbox read-only views for Leads, Email, Events, and Metrics.
6. Add Theo SMS adapter.
7. Add Aria/Vapi voice adapter.
8. Add Olivia website chat adapter.
9. Add WhatsApp adapter when the SMS flow is stable.

## Out Of Scope For V1

- Replacing the client's CRM.
- Full admin editing of every field in Agent Inbox.
- A separate production database.
- Complex permissions.
- Advanced analytics.
- Long-term nurture campaign builder.
- Multi-client master workbook.

## Open Decisions

- Exact frontend framework for Agent Inbox.
- Whether Agent Inbox is built inside this repo or a small separate app.
- Whether Vapi is the first voice provider.
- Which SMS provider is first: Twilio direct or GoHighLevel webhook.
