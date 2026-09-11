# Outreach Demo Room handoff

This repository owns the Demo Room generator used after an outreach prospect replies positively.

## Plain-language flow

```text
The outreach queue sees “yes”
→ it verifies the prospect and active listing
→ it calls this app’s Demo Room generator
→ this app creates one private room
→ the outreach queue replies in the original AgentMail thread
```

The orchestration, reply classification, sender identity, delivery mode, and follow-up state live in [`Ofunrein/iris-outreach-queue`](https://github.com/Ofunrein/iris-outreach-queue). Its canonical setup guide is [`docs/POSITIVE_REPLY_DEMO_AUTOMATION.md`](https://github.com/Ofunrein/iris-outreach-queue/blob/main/docs/POSITIVE_REPLY_DEMO_AUTOMATION.md).

## This repository’s boundary

- Generator route: `lumenosis-site/app/api/admin/demos/generate/route.ts`
- Input includes prospect identity, business, verified listing address and URL, sender inbox, and an immutable idempotency key.
- New rooms are private by default.
- The generator returns the Demo Room URL and admin-review URL.
- The generator does not decide whether AgentMail sends or drafts the reply.
- The generator does not own the cold sequence or post-demo cadence.

## Delivery-mode rule

The queue must explicitly choose one mode:

- `automatic`: build the room and send the same-thread reply.
- `draft`: build the room and save the reply for review.

If the operator says “reply when they say yes,” that means `automatic`. Do not insert a draft gate unless the operator asks for drafts or approval.

## Safe rebuild

1. Read the queue repository’s canonical guide.
2. Confirm this generator route is the deployed production route.
3. Keep the inbound AgentMail message ID as the idempotency key.
4. Verify listing evidence before generation.
5. Verify one private room and one same-thread response using QA accounts.
6. Repeat the sync and prove no duplicate room or response is created.
7. Confirm any later reply cancels follow-ups.

Do not use `deprecated/agent.py` for this workflow. The hosted TypeScript application owns Demo Room generation; the Cloud Run queue owns outreach orchestration.
