# Iris Context-Aware Lead Capture and Nurture

## Decision

Iris uses one durable context envelope and one decision policy across SMS, WhatsApp, Instagram, Messenger, email, and website chat. Channel code may format and transport replies, but may not invent separate qualification, safety, consent, or handoff rules.

## Delivery scope

1. Normalize forms, ads, CRM automations, Make, n8n, and website events through one authenticated lead-capture contract.
2. Persist source, campaign, behavior, property, consent, and raw provider metadata before reply generation.
3. Build the context envelope from lead memory, recent cross-channel events, provider metadata, and matching property records.
4. Produce one decision: `auto_send`, `draft`, `human_alert`, `stop`, or `nurture`.
5. Stop queued nurture after every inbound reply. Respect opt-outs, takeover, sensitive topics, and newer messages.
6. Keep sender ownership unchanged: Twilio, Meta/ManyChat/Composio, Gmail, and website adapters remain transports.

## Acceptance gates

- New lead context references the actual property or campaign and asks at most one micro-question.
- Duplicate capture events never create duplicate replies.
- Sensitive requests receive safe factual help plus human review, never unsupported advice.
- An inbound reply cancels queued cadence tasks for that lead.
- SMS stays under 320 characters; social and WhatsApp stay compact; email preserves thread-style copy.
- Context fingerprint, decision, source attribution, handoff reason, and latency are stored on the reply job.
- Unit, integration, TypeScript, Python, lint, and production build suites pass.

## Deferred

- Vendor-specific GHL setup UI.
- Replacing existing channel transports.
- Voice rendering beyond sharing the same persisted lead context.
- RentCast enrichment. Keep it disabled and out of this implementation because current usage cost is too high.
