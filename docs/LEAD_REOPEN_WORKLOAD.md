# Lead Reopen Workload

## Positioning

Lumenosis is a managed AI implementation service, not self-serve SaaS. Lead Reopen is the first-class workflow for recovering old real estate leads before ongoing omnichannel handling takes over.

## Current Scope

The first shipped slice is import plus segmentation:

1. Import leads from CSV exports, JSON/manual rows, Composio-fed connector rows, and configured CRM pulls.
2. Normalize every source into canonical lead memory.
3. Deduplicate by email, phone, CRM/source id, and normalized name.
4. Segment leads for review.
5. Block campaign eligibility for do-not-contact, missing contact info, and needs-human rows.
6. Persist import batches and row outcomes.
7. Keep outbound campaign sending off until a human explicitly reviews and launches a later campaign step.

## UI Surface

Visible tab: `Lead Reopen`

The tab owns:

- CSV export upload.
- CRM pull through the configured import-capable CRM adapter.
- Dry-run preview before writes.
- Batch summary.
- Segment distribution.
- Row preview with eligibility.
- Recent persisted batches.

## Data Sources

Preferred connector path:

- Composio for general SaaS connectors and supported CRMs when coverage is deep enough.

Direct adapter path:

- GoHighLevel first.
- Follow Up Boss, Lofty/Chime, kvCORE, Sierra, Real Geeks, BoomTown, and CINC as direct adapters when Composio is shallow or unavailable.

Fallback path:

- CSV remains mandatory for every client.

## Segments

Default segments:

- Hot buyer
- Seller / valuation
- Showing-ready
- Nurture
- Financing
- Renter
- Needs human
- Missing contact info
- Do not contact
- Duplicate / merged
- Closed / no reply

## Safety Rules

- Fresh imports never send messages automatically.
- Campaign activation is a separate reviewed step.
- Consent and do-not-contact fields override lead score.
- Raw source data is retained on import rows so CRM-specific mappings can improve later without re-importing.

## Next Execution Phases

### Phase 1: Import Visibility

Status: shipped.

- Add visible Lead Reopen tab.
- Expose CSV preview/import.
- Expose CRM pull/import.
- Show batch and segment summary.
- Show recent batches.

### Phase 2: Field Mapping Control

- Add editable column mapping before import.
- Save per-client mapping presets.
- Flag unmapped high-value fields.

### Phase 3: Campaign Review Queue

- Create `lead_reopen_candidates`.
- Let operators approve, defer, or exclude candidates.
- Show blocked reasons and consent status.

### Phase 4: Reactivation Campaigns

- Add reviewed campaign drafts.
- Add channel selection by consent and preference.
- Add stop-on-reply and human handoff.
- Log every campaign outcome back to lead memory and CRM.

### Phase 5: CRM Writeback

- Write segment, status, notes, and campaign outcomes back to source CRM.
- Keep direct adapters and Composio connectors behind one source contract.
