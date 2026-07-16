# deprecated/ - frozen legacy code, not the product

Nothing in this folder runs in production. Do not read files here to diagnose
live behavior, and do not edit them expecting a runtime effect.

## agent.py (legacy Iris email daemon)

The old Python 60s Gmail polling daemon. **Superseded by the TypeScript runtime.**
Live Iris = Gmail push webhook to Inngest to `lib/irisEmail.ts` +
`lib/propertyRetrieval.ts`. See `docs/decisions/2026-07-15-deprecate-agent-py.md`
for the full live-path map.

If you are an agent debugging Iris: **ignore this folder entirely.**
