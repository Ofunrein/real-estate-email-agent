# Iris Omnichannel Competitive Research

Date: 2026-06-19

Scope: Speculo AI / Remi public research, the Ryse Realty Google Voice export, and the migration plan for making Iris the single Lumenosis real estate ISA personality across email, SMS, WhatsApp, social DMs, voice, and website chat.

## Public Speculo / Remi Capability Map

Sources reviewed:

- Speculo homepage: https://www.speculo.ai/
- Speculo demo page: https://www.speculo.ai/schedule-a-demo
- HousingWire REMAX Advantage article: https://www.housingwire.com/articles/remax-advantage-ai-calls/
- Speculo insights article: https://www.speculo.ai/press/real-estates-hottest-gossip
- Local Google Voice export: `docs/Voice - (29) Messages (6_19_2026 5：16：43 PM).html`

Observed capabilities:

- Database upload and CRM connection as onboarding step.
- AI follow-up across voice, email, and text.
- Cold lead revival and missed-lead recovery.
- Fast outbound call after lead capture.
- Live call transfer to the human agent/team.
- Appointment/calendar booking positioning.
- Property Q&A on beds, baths, square feet, service needs, and next steps.
- Escalation on urgency or topics that require a licensed Realtor.
- Conversational IDX/property search.
- Buyer behavior tracking from website activity, listing alerts, saved/search activity, and verified data.
- Local-language property search that maps human requests into listing criteria and trend signals.

What Speculo appears to be selling is not just an AI caller. It is a lead-reactivation and listing-aware ISA layer that can contact stale database leads, search listings, send property links/media, transfer calls, and keep CRM/calendar state warm.

## Ryse / Remi Conversation Evidence

The Google Voice export shows this Ryse Realty flow:

1. Remi reactivated the lead with a low-friction opener: checking whether the lead was still thinking about buying or selling in Austin or whether plans shifted.
2. The lead replied that they were still interested in buying in Austin and asked for 2 bed / 2 bath options downtown under $1M.
3. Remi first asked generic qualification follow-ups, then sent three listing matches from `aisearch.rysehomes.com` with price, beds/baths, square footage, status, and property URLs.
4. When the lead asked for details and photos of the first property, Remi sent a property summary, a listing link, and an image attachment.
5. When the lead asked for more photos and details by email, Remi sent another SMS listing instead of executing the email handoff.
6. When the lead asked for a call, Remi acknowledged the call request but the export does not show a completed call transfer or booked appointment.
7. When the lead typed `Speculo ai?`, Remi treated it as a property search query and searched for listings, which is a clear intent-classification miss.
8. When the lead asked for Columbus, Ohio, Remi searched out-of-market and returned no active listings, then asked whether to expand nearby areas.
9. The export contains stale real estate follow-ups from other teams, financing/lender nudges, spam-like threads, and old "given up?" cadence. Iris needs stronger thread hygiene and source filtering.

The Ryse AI search domain used in the thread:

```text
https://aisearch.rysehomes.com/property/5013978221052957045?tenant_id=YQxX9erMaCPdeBOYthLK&mls_osn=Austin&no_squeeze=true
https://aisearch.rysehomes.com/property/5010086478384677653?tenant_id=YQxX9erMaCPdeBOYthLK&mls_osn=Austin&no_squeeze=true
https://aisearch.rysehomes.com/property/5018084977197200761?tenant_id=YQxX9erMaCPdeBOYthLK&mls_osn=Austin&no_squeeze=true
```

## Iris Should Beat Remi Here

Iris should be one branded personality with channel-specific transports, not separate public agent names. The channel can change, but the lead should always feel they are talking to the same person.

Required advantages:

- One memory layer: every touch writes to `lead_memory` and `conversation_events`, with lead identity merged by phone/email/name.
- One identity: Agent Inbox, stored events, summaries, handoff alerts, and customer-facing copy say Iris.
- Channel preference execution: if a lead asks for email, Iris sends or drafts the email and stores email as preferred channel. If they ask for a call, Iris triggers voice handoff/outbound call or creates a human call task.
- Listing-aware search: property results must include exact match reasons, constraints used, and source URL. If the lead says "downtown under 1m 2/2", Iris should not ask for price range again.
- Media correctness: send requested photos, not random next listings. If photos are missing, say that and provide the listing/gallery link.
- Intent guardrails: "Speculo AI?" is not a property search. Route to human or answer as a business/product question depending on client context.
- Market boundary logic: know whether the client serves Austin only, Central Texas, or national referrals before searching Columbus.
- Cadence brain: no duplicate touches, one channel per day, quiet hours, consent state, stop-on-reply, and no system/OTP/spam threads in the agent inbox.
- Appointment state: booking, reschedule, cancel, transfer, and follow-up all read/write the same shared appointment store.
- Observable reasoning: Agent Inbox should show why Iris searched, why she asked a question, why she escalated, and what next action is queued.

## Current Implementation Direction

This repo should keep legacy route and module names for compatibility while moving runtime identity and new capability docs to Iris.

Keep:

- `agent.py` as the legacy Python email poller for now.
- Existing Vercel webhook paths like `/api/webhooks/theo-sms`, `/api/webhooks/theo-whatsapp`, `/api/webhooks/aria-voice`, and `/api/webhooks/olivia-website` until external vendors are migrated.
- Existing env names like `ARIA_*` and `THEO_*` until a compatibility alias layer is added.

Change:

- Runtime `agentName` defaults should be Iris across email, SMS, WhatsApp, voice, website chat, Messenger, and Instagram.
- Agent Inbox channel labels should show Iris, not Theo/Aria/Olivia.
- New docs and new customer-facing copy should call the product personality Iris.
- ManyChat/social docs should call the handler Iris while noting legacy `theo:*` tags may remain temporarily.

## Vercel Migration Plan

Phase 1: Identity and inbox

- Add a shared Iris identity constant.
- Replace stored outbound `agentName` values with Iris.
- Replace channel UI labels with Iris.
- Keep legacy route names stable.

Phase 2: Email on Vercel

- Extract reusable `agent.py` capabilities into TypeScript modules: Gmail read/write, email classification, reply generation, compliance/handoff labels, and event writes.
- Add Vercel route handlers or scheduled functions for email polling.
- Treat `agent.py` as `legacy_iris_email_agent` until the hosted TypeScript flow matches behavior.

Phase 3: Cadence queue

- Add a durable cadence queue keyed by lead identity.
- Enforce one channel per day, quiet hours, stop-on-reply, max touches, consent, and reserved/test number blocking before spend or sends.
- Queue tasks for SMS, email, voice, WhatsApp, Messenger, Instagram, and manual human follow-up.

Phase 4: AI search / Ryse client config

- Add client-level search URL config, for example:

```bash
CLIENT_ID=ryse-realty
CLIENT_NAME=Ryse Realty
NEXT_PUBLIC_AI_SEARCH_BASE_URL=https://aisearch.rysehomes.com
AI_SEARCH_TENANT_ID=YQxX9erMaCPdeBOYthLK
AI_SEARCH_MLS_OSN=Austin
```

- Generate property links through a single helper so SMS, email, voice follow-up, social DM, and website chat all point to the same search domain.

Phase 5: Quality gates

- Add fixture tests from the Ryse transcript:
  - database revival opener
  - 2 bed / 2 bath / downtown / under $1M search
  - details + photos request
  - email preference request
  - call request
  - product/business question misclassified as property search
  - out-of-market request
- Run TypeScript tests, Python contract tests, `npm run lint`, and `npm run build` before shipping.

## Product Positioning

Iris should be described as the single omnichannel inside-sales agent for real estate teams. She can call, text, email, DM, chat, search listings, send media, qualify leads, revive old database contacts, book appointments, update CRM state, and hand off to a human when judgment or licensing matters.

The competitive angle is not "we also have Remi features." It is:

- one identity across every channel,
- stronger memory and channel preference execution,
- better property-search grounding,
- better handoff and appointment state,
- Vercel-native deployability,
- auditable inbox operations instead of opaque automation.
