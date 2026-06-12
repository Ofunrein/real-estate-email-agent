# Sheets Property Full Backfill

## Objective

Bring the Google Sheet **properties** tab to full parity with Neon (and recoverable backup/CSV sources) for all required listing fields, without disabling Neon or running paid enrichment unless explicitly approved.

## Original Request

Google Sheet properties tab still missing many fields despite Neon being up to date:
https://docs.google.com/spreadsheets/d/1q9RPPD8LZxNGDknudrxCg9kk1VXj-sboEWzmThxiDMs/edit?gid=1210829357

User wants:
- Compare properties tab vs backup tabs vs Neon
- Fill ALL of these (must be populated): address, price, beds, baths, state, zip, description, neighborhood, property_type, features, days_on_market, photo_url, sqft, year_built, status, listing_url
- EXCLUDE from fill requirements: agent_name, agent_email (user doesn't care)
- Prefer backfill from Neon, CSV, backup sheets — only enrich (AI/Apify/RentCast) if data truly missing everywhere
- Do NOT disable Neon; avoid paid Apify unless task explicitly allows with user approval
- User invoked /goalbuddy — PREP ONLY during prep turn; execution deferred to `/goal`

## Intake Summary

- Input shape: `specific`
- Audience: Martin (operator) — Austin Realty property data in Google Sheets
- Authority: `requested`
- Proof type: `metric`
- Completion proof: Fill-rate report shows required columns ≥99% populated where source data exists in Neon/backups/CSV; zero rows where Neon has value but Sheet cell is empty (`neon_has_sheet_empty = 0`)
- Goal oracle: Automated fill-rate report comparing Neon vs properties tab vs backup tabs for the 15 required columns; audit passes with `neon_has_sheet_empty: 0` and required-column coverage ≥99% where recoverable source exists
- Likely misfire: Running paid Apify/RentCast enrichment when Neon or backup tabs already have the data; syncing only a subset of columns; treating agent fields as required; disabling DATABASE_URL/Neon; marking done after Scout without actually writing to Sheet
- Blind spots considered:
  - Sheet ID / tab GID mapping and sync script entrypoints unknown until Scout
  - Backup tab naming and column schema may differ from properties tab
  - Row-key alignment (listing URL vs internal ID) may cause false "missing" signals
  - Google Sheets API auth / service account scope may block writes
  - Free vs paid enrichment paths need explicit gate before Worker runs
- Existing plan facts:
  - Sheet URL: `https://docs.google.com/spreadsheets/d/1q9RPPD8LZxNGDknudrxCg9kk1VXj-sboEWzmThxiDMs/edit?gid=1210829357`
  - Required columns: address, price, beds, baths, state, zip, description, neighborhood, property_type, features, days_on_market, photo_url, sqft, year_built, status, listing_url
  - Excluded columns: agent_name, agent_email
  - Source priority: Neon → CSV → backup sheets → free local indexes → paid enrich only with approval
  - Hard constraints: keep Neon enabled; no paid Apify without user approval; no sync/enrichment during prep

## Goal Oracle

The oracle for this goal is:

**Fill-rate report** on the 15 required columns across Neon, properties tab, and backup tabs, with:
- `neon_has_sheet_empty: 0` (no row where Neon has a value and the properties tab cell is empty)
- Required columns **≥99% filled** wherever recoverable source data exists (Neon, CSV, or backup tabs)
- Excluded fields (agent_name, agent_email) out of scope

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`specific`

## Current Tranche

1. Scout maps fill rates and recoverable data paths (Neon vs properties vs backups/CSV/indexes) without paid runs.
2. Scout lists free enrichment paths for still-missing fields (existing scripts only).
3. Judge selects largest safe Worker package (likely: merge backups → Neon gaps → sync-db-to-sheets; optional free enrichment).
4. Worker executes bounded backfill and sync.
5. Judge final audit with fill-rate oracle.

## Non-Negotiable Constraints

- Do **not** disable Neon or `DATABASE_URL`.
- Do **not** run paid Apify unless a task explicitly allows it **and** user approves.
- Prefer Neon → CSV → backup sheets before any AI/Apify/RentCast enrichment.
- **agent_name** and **agent_email** are explicitly out of scope.
- Required columns must be populated when source data exists anywhere in the recovery chain.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete (oracle metrics met).

Do not stop after planning, discovery, or Judge selection if a safe Worker task can sync/backfill.

Do not stop after a single verified Worker package if required columns still fail the oracle.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. Judge should prefer one coherent Worker package: gap analysis → Neon/backfill merge → sheets sync → fill-rate verify, rather than per-column micro-tasks.

## Canonical Board

Machine truth lives at:

`docs/goals/sheets-property-full-backfill/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins.

## Run Command

```text
/goal Follow docs/goals/sheets-property-full-backfill/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter and `state.yaml`.
2. Work only on the active board task.
3. Scout/Judge read-only; Worker writes only inside `allowed_files` from Judge.
4. Verify fill-rate oracle after each sync Worker package.
5. Block paid enrichment tasks pending user approval.
6. Finish only when T999 records `full_outcome_complete: true` against the oracle.
