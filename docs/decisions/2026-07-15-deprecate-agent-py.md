# Decision: Deprecate agent.py (legacy Iris Python daemon)

**Date:** 2026-07-15
**Owner:** Martin Ofunrein
**Status:** Adopted

## Decision
`agent.py` is deprecated and moved to `deprecated/agent.py`. It is NOT the Iris
runtime and must not be read, edited, or used to diagnose live email behavior.

## Why
Agents (and humans) kept re-reading `agent.py` when debugging why Iris replied or
didn't, because the old `CLAUDE.md` listed Iris as `agent.py`. That is wrong and
wasted multiple debugging sessions. The live product is 100% TypeScript on
Vercel + Inngest.

## Live Iris path (the ONLY thing that runs in prod)
1. Gmail Pub/Sub push -> `app/api/webhooks/iris-gmail-push/route.ts` (emits `gmail.push.received`)
2. Inngest handler -> `lib/inngest/functions/gmailPushReceived.ts`
3. Classification -> `lib/irisEmail.ts` (`classifyIrisEmailText`, reply composition in `generateIrisEmailReplyRich`)
4. Property matching -> `lib/propertyRetrieval.ts` (`retrievePropertiesForAgent`: Neon structured/RAG, then Apify import fallback when empty)

Trigger is the Gmail push webhook, NOT a Vercel cron (`vercel.json` crons = []).

## Actions
- [x] Moved `agent.py` -> `deprecated/agent.py`.
- [x] Added a loud DEPRECATED banner to the top of the file.
- [x] Added `deprecated/README.md`.
- [x] Fixed `CLAUDE.md` to describe the TS live path and mark `agent.py` deprecated.
- [x] Documented this decision (this file).

## Rollback
None planned. If the Python daemon is ever needed again, move it back out of
`deprecated/` and re-wire its scheduler; no live TS code depends on it.
