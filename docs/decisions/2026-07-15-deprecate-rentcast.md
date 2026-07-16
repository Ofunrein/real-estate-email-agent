# Decision: Deprecate RentCast

**Date:** 2026-07-15
**Owner:** Martin Ofunrein
**Status:** Adopted

## Decision
Drop RentCast from the real-estate email agent. It is too expensive to justify
right now, and the live product already covers property/market context with
free data sources.

## Why
- RentCast is a paid API with per-lookup cost that does not pencil out at
  current volume.
- The live TypeScript product (`app.lumenosis.com`) **already runs without
  RentCast**. Property/market enrichment is handled by:
  - **FRED** — live 30yr/15yr mortgage rates (free)
  - **US Census ACS** — median household income / population by ZIP (free)
  - **Socrata** — public property records / open-data datasets (free)
  - **Apify Zillow** — listing facts + sold comps (already in the stack)
- Regression test already enforces this:
  `tests/ts/publicPropertyData.test.ts` →
  `fetchPublicPropertyContext: uses FRED, Census, and Socrata without RentCast`
  and asserts no rentcast URL is ever called.

## Current state (verified 2026-07-15)
- **Live path (TS / Vercel):** no RentCast. Enrichment = `lib/publicPropertyData.ts`
  (FRED + Census + Socrata) + Apify. Nothing to disable.
- **Legacy only:** `agent.py` (`rentcast_lookup`, `RENTCAST_API_KEY`) and
  `scripts/property_hygiene.py` still reference RentCast. agent.py is the
  deprecated legacy runtime and is not the product.

## Actions
- [x] Documented decision (this file).
- [ ] Do NOT renew / cancel the RentCast subscription.
- [ ] Remove `RENTCAST_API_KEY` from active `.env` / Vercel prod (leave legacy
      agent.py refs untouched — legacy is frozen).
- [ ] `property_hygiene.py`: keep `rentcast_lookup_enabled=False` (already the
      default) so the hygiene script never calls RentCast.

## Rollback
If a data gap appears that FRED/Census/Socrata/Apify cannot fill, re-enable by
restoring `RENTCAST_API_KEY` and setting `rentcast_lookup_enabled=True` in
`property_hygiene.py`. No live TS code change needed.
