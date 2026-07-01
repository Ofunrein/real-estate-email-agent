# Agent Action API

Shared server-side action layer for Iris, Theo, Aria, Olivia, and future client agents.

## Endpoint

`POST /api/agent/actions`

Auth: same webhook secret path as other internal agent webhooks.

## Actions

- `send_text` — SMS or WhatsApp through the current provider path.
- `send_email` — Gmail reply/fresh email through Iris mailbox.
- `send_social_dm` — Instagram or Messenger through Meta direct/fallback provider path.
- `start_call` — Vapi outbound call through Aria.
- `book_appointment` — active calendar provider, then appointment record.
- `flag_human_followup` — records a needs-human event without sending.

## Required guard context

Every outbound action must include captured trigger context before it can run:

```json
{
  "context": {
    "captured": true,
    "trigger": "shared_reel",
    "reason": "Lead asked for homes similar to the reel.",
    "summary": "Instagram lead wants similar Austin listings under 500k."
  }
}
```

A thread reference or known lead identity can also satisfy shared context, but the best path is explicit `context.captured=true` with `trigger`, `reason`, and `summary`.

## Client scalability

The action layer reads `inbox_settings` before provider calls:

- disabled channel -> blocked and logged
- auto-send off -> blocked with `safeFallback: "draft"`
- SMS opt-out -> blocked
- outbound call without call consent -> blocked

This lets new clients onboard by changing client settings and provider connections, not editing each agent.

## Example

```json
{
  "action": "send_social_dm",
  "actorAgent": "Theo",
  "channel": "instagram",
  "to": "17841400000000000",
  "body": "I can send similar Austin homes here. Want houses or condos?",
  "threadRef": "instagram:17841400000000000",
  "lead": {
    "fullName": "Maya Chen",
    "preferredChannel": "instagram"
  },
  "context": {
    "captured": true,
    "trigger": "shared_reel",
    "reason": "Lead shared a property reel and asked for similar homes.",
    "summary": "Looking for similar modern Austin listings."
  }
}
```

Blocked actions still write an audit/interaction event, so failures show up in Ops instead of silently disappearing.
