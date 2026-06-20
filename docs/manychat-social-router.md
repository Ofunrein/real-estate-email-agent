# ManyChat Social Router

Iris handles routed real-estate DMs from ManyChat. ManyChat remains the inbox, campaign, and sender of record.

## Environment

```bash
ENABLE_SOCIAL_DM_AGENT=true
ENABLE_SOCIAL_DM_IMAGES=true
SOCIAL_DM_MAX_IMAGES=3
MANYCHAT_API_KEY=
MANYCHAT_SOCIAL_ROUTER_FLOW_NS=
MANYCHAT_THEO_REPLY_FIELD=lumenosis_theo_reply
MANYCHAT_THEO_MEDIA_FIELD=lumenosis_theo_media_urls
MANYCHAT_THEO_STATUS_FIELD=lumenosis_theo_status
```

`CHANNEL_WEBHOOK_SECRET` protects the router endpoint.

The `THEO` env/key names are legacy compatibility names. New customer-facing copy and stored conversation events should identify the agent as Iris.

## Required ManyChat Assets

Tags:

- `theo:routed`
- `theo:auto-sent`
- `theo:needs-human`
- `theo:media`

Custom fields:

- `lumenosis_channel`
- `lumenosis_thread_ref`
- `lumenosis_route_reason`
- `lumenosis_theo_status`
- `lumenosis_theo_reply`
- `lumenosis_theo_media_urls`
- `lumenosis_theo_intent`

Check the connection:

```bash
node scripts/manychat-social-setup.mjs --dry-run
```

Create missing tags/fields when supported by the ManyChat Public API:

```bash
node scripts/manychat-social-setup.mjs --apply
```

This script does not create or edit ManyChat flows. Build flows in the ManyChat UI.

## Dynamic Block

URL:

```text
https://YOUR_PUBLIC_BASE_URL/api/webhooks/theo-social-router?format=manychat
```

Header:

```text
x-lumenosis-webhook-secret: YOUR_CHANNEL_WEBHOOK_SECRET
```

Body:

```json
{
  "channel": "instagram",
  "message_text": "{{last_text_input}}",
  "contact_id": "{{contact.id}}",
  "sender_name": "{{contact.name}}",
  "route_reason": "listing_question",
  "campaign": "listing_comment_dm",
  "listing_address": "{{listing_address}}"
}
```

Use `channel: "messenger"` for Facebook Messenger flows.

## Flow Rules

Route only business-intent flows into Iris:

- listing keyword
- comment-to-DM
- ad DM
- story CTA
- manual agent route

Do not send personal/general inbox messages to Iris unless a human explicitly routes the thread.

If Iris returns an empty Dynamic Block `messages` array, branch to human in ManyChat, apply `theo:needs-human`, and stop automation.

## Local Smoke Test

Start the app, then run:

```bash
node scripts/test-manychat-social-router.mjs
```

The script exercises Instagram, Messenger, and handoff samples against the running app.
