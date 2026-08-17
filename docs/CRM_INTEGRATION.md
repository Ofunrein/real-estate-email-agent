# CRM Integration

Everything here is read off the code in `lib/crm/`. Where an adapter is a stub, this document says so instead of implying coverage.

- Contract: [`lib/crm/types.ts`](../lib/crm/types.ts)
- Resolver: [`lib/crm/index.ts`](../lib/crm/index.ts)
- Provider catalogue: [`lib/crm/providers.ts`](../lib/crm/providers.ts)
- Adapters: [`ghl.ts`](../lib/crm/ghl.ts) · [`followupboss.ts`](../lib/crm/followupboss.ts) · [`kvcore.ts`](../lib/crm/kvcore.ts)
- Tests: `tests/ts/ghlAdapter.test.ts`, `tests/ts/crmProviders.test.ts`

---

## 1. The contract

One provider-agnostic interface, deliberately not shaped around any single vendor so Follow Up Boss's `people`/`events` and kvCORE's `contacts` both map cleanly:

```ts
interface CrmAdapter {
  readonly provider: string;

  findContactByPhone(phone: string): Promise<CrmContact | null>;
  findContactByEmail(email: string): Promise<CrmContact | null>;
  upsertContact(input: CrmContactInput): Promise<CrmContact>;

  listAppointments(contactId: string): Promise<CrmAppointment[]>;
  createAppointment(input: CrmAppointmentInput): Promise<CrmAppointment>;
  updateAppointment(id: string, update: CrmAppointmentUpdate): Promise<CrmAppointment>;
  cancelAppointment(id: string): Promise<void>;

  logActivity(activity: CrmActivity): Promise<void>;
  updateContactCustomFields?(contactId: string, fields: CrmCustomFieldValue[]): Promise<void>;
}
```

Lead import is a **separate, optional capability**, not part of the base interface:

```ts
interface CrmImportAdapter {
  listImportableLeads(input?: CrmLeadImportCursor): Promise<CrmLeadImportPage>;
}

hasCrmImport(adapter)  // runtime type guard — checks the method actually exists
```

Call sites use `hasCrmImport()` rather than checking the provider name, so adding import support to an adapter enables the feature with no change at the call site.

All times are ISO 8601 strings. `CrmContact` carries `id`, name parts, `email`, `phone`, `tags`, `source`.

---

## 2. Resolution and graceful degradation

`resolveCrmAdapter(config, env)` picks the adapter from `CRM_PROVIDER` (normalized through the alias table) and **returns `null` whenever required credentials are absent**:

| `CRM_PROVIDER` | Required env | Adapter |
|---|---|---|
| `ghl` (default) | `GHL_PRIVATE_INTEGRATION_TOKEN` or `GHL_LOCATION_PIT`, **plus** `GHL_LOCATION_ID` | `createGhlAdapter` |
| `kvcore`, `lofty`, `chime` | `KVCORE_API_KEY` (optional `KVCORE_BASE_URL`) | `createKvcoreAdapter` |
| `fub`, `followupboss` | `FUB_API_KEY` | `createFollowUpBossAdapter` |
| anything else | — | `null` |

Returning `null` rather than throwing is the key design choice: **a missing or misconfigured CRM degrades the CRM feature and leaves the reply path working**. Leads still land in Lumenosis lead memory either way.

`CRM_PROVIDER` is normalized in `lib/clientConfig.ts` (`normalizeCrmProvider`, default `"ghl"`), so it is per-client config, not a global constant.

### Where the adapter is used

| Call site | Uses it for |
|---|---|
| `lib/ariaTools.ts` | `getCrm()` — the voice agent's CRM tool surface |
| `lib/ariaCalendar.ts` | Contact lookup, appointment create/update/cancel during calls |
| `app/api/leads/import/route.ts` | Guarded by `hasCrmImport()`; reports whether the active CRM supports import |
| `app/api/actions/summarize-conversation/route.ts` | Writes the conversation summary back as CRM activity |

---

## 3. GHL / HighLevel — the fully implemented adapter

Base `https://services.leadconnectorhq.com`, header `Version: 2023-02-21`, bearer token. Endpoints were verified against HighLevel's public OpenAPI:

| Interface method | HTTP call | Notes |
|---|---|---|
| `findContactByPhone` / `findContactByEmail` | `GET /contacts/search/duplicate?locationId&number&email` | Shared `findDuplicate()` helper |
| `upsertContact` | `POST /contacts/upsert` | Defaults `source: "lumenosis_agent_os"`, tags to `GHL_CONTACT_TAG` (default `lumenosis-agent-os`) |
| `listImportableLeads` | `GET /contacts/?locationId&limit&startAfterId&updatedAfter` | Cursor from `nextPageUrl` / `startAfterId` / `nextCursor`, page size default 100 |
| `listAppointments` | `GET /contacts/{id}/appointments` | Reads `events` or `appointments` |
| `createAppointment` | `POST /calendars/events/appointments` | Sets `appointmentStatus: "confirmed"`; `meetingLocationType: "custom"` when an address is given |
| `updateAppointment` | `PUT /calendars/events/appointments/{id}` | |
| `cancelAppointment` | `DELETE /calendars/events/{id}` | Note: `/calendars/events/`, not `/appointments/` |
| `logActivity` | `POST /conversations/messages` | `type` from `GHL_MESSAGE_TYPE`, **default `InternalComment`** |
| `updateContactCustomFields` | `PUT /contacts/{id}` | No-ops when no field has both a key/id and a non-blank value |

Two details that matter operationally:

- **`logActivity` defaults to `InternalComment`.** That writes an internal note visible to the team, *not* an outbound message to the lead. Changing `GHL_MESSAGE_TYPE` to an external type means the CRM will actually message the contact.
- **The HTTP layer is injectable.** `createGhlAdapter(config, request?)` takes an optional `GhlRequest`, which is how `tests/ts/ghlAdapter.test.ts` asserts every payload with no network access.

### Env

```bash
CRM_PROVIDER=ghl
GHL_PRIVATE_INTEGRATION_TOKEN=      # or GHL_LOCATION_PIT
GHL_LOCATION_ID=
GHL_CALENDAR_ID=                    # read by clientConfig().calendarId
GHL_CONTACT_TAG=lumenosis-agent-os  # optional
GHL_MESSAGE_TYPE=InternalComment    # optional; see warning above
```

---

## 4. Follow Up Boss — interface-complete, partially stubbed

Base `https://api.followupboss.com/v1`, HTTP Basic (`<FUB_API_KEY>:`), plus `X-System: Lumenosis Agent OS` and `X-System-Key` headers.

| Method | Call | Status |
|---|---|---|
| `findContactByPhone` / `findContactByEmail` | `GET /people?phone=/email=&limit=1` | Implemented; **swallows errors and returns `null`** |
| `upsertContact` | `POST /people` | Implemented. Despite the name it always POSTs — it relies on FUB-side dedupe, it does not update a match it found. |
| `listAppointments` | `GET /appointments?personId=` | Implemented; returns `[]` on error |
| `createAppointment` / `updateAppointment` / `cancelAppointment` | `POST` / `PUT` / `DELETE /appointments` | Implemented |
| `logActivity` | `POST /notes` | Implemented; `isPublic: false`, subject `[channel/direction]` |
| `listImportableLeads` | — | **Not implemented.** `hasCrmImport()` is false, so lead import is correctly reported as unsupported. |

Caveats to know before switching a client to FUB: `updateAppointment` returns `contactId: ""` (the API response is not re-read for it), and `contactId` is coerced with `Number()`, so a non-numeric id becomes `NaN`. The file's own header calls it a stub — treat the first FUB onboarding as an implementation task, not a config change.

```bash
CRM_PROVIDER=fub
FUB_API_KEY=
```

---

## 5. kvCORE / Lofty — interface-complete, partially stubbed

Base `KVCORE_BASE_URL` or `https://api.kvcore.com/v2`, bearer token. Snake_case field mapping (`first_name`, `last_name`, `start_time`).

| Method | Call | Status |
|---|---|---|
| `findContactByPhone` / `findContactByEmail` | `GET /contacts?phone=/email=&limit=1` | Implemented; returns `null` on error |
| `upsertContact` | `POST /contacts` | Implemented; relies on kvCORE dedupe by email/phone |
| `listAppointments` | — | **Explicit stub — always returns `[]`** |
| `createAppointment` / `updateAppointment` / `cancelAppointment` | `POST` / `PATCH` / `DELETE /appointments` | Implemented |
| `logActivity` | `POST /contacts/{id}/notes` | Implemented |
| `listImportableLeads` | — | Not implemented; CSV import is the working path |

`lofty_chime` maps to this same adapter (`directAdapter: "kvcore"`).

```bash
CRM_PROVIDER=kvcore   # or lofty / chime
KVCORE_API_KEY=
KVCORE_BASE_URL=      # optional
```

---

## 6. Provider catalogue — all 31 entries

`lib/crm/providers.ts` classifies every known CRM into one of four support paths, with alias matching so `gohighlevel`, `high_level`, `leadconnector` all resolve to `ghl`:

| Path | Meaning | Providers |
|---|---|---|
| `direct_adapter` | Native adapter in `lib/crm/` | HighLevel, Follow Up Boss, kvCORE, Lofty/Chime |
| `composio` | Via Composio import/action mapping, or CSV | HubSpot, Salesforce, Pipedrive, Zoho |
| `csv_first` | CSV/export import works today; direct adapter addable | AccuLynx, AgentLocator, BoomTown, Brivity, Builder Prime, Buildertrend, CINC, Firepoint, Housecall Pro, Improveit 360, Jobber, JobNimbus, Jungo, LeadPerfection, Leap, MarketSharp, RealGeeks, ServiceMonster, ServiceTitan, Sierra Interactive, Wise Agent, Other |
| `none` | No CRM; leads stay in Lumenosis lead memory | None |

Each entry also carries a `category` (`real_estate`, `home_services`, `sales`, `none`), which is how onboarding groups the picker.

Helpers: `normalizeCrmProvider(value)` → canonical id · `resolveCrmProviderDefinition(value)` → full definition · `directCrmAdapterKey(value)` → `"ghl" | "fub" | "kvcore" | ""` · `crmProviderLabels()` → display labels.

---

## 7. Event mirroring: `npm run sync:ghl`

`scripts/sync-events-to-ghl.mjs` is a **separate batch path** from the runtime adapter. It back-fills `conversation_events` into GHL as internal comments so the CRM timeline matches the Agent Inbox.

```bash
npm run sync:ghl                 # dry-run (default)
npm run sync:ghl -- --live       # actually post messages
npm run sync:ghl -- --limit 50   # cap events considered
npm run sync:ghl -- --force      # re-sync already-synced events
```

How it works:

1. Loads leads + events from Neon (or Sheets when `DATABASE_URL` is unset).
2. Indexes leads by email, phone, and full name; matches each event to a lead in that order.
3. Hashes each event — SHA-256 over `client_id | event_at | channel | direction | email | phone | thread_ref | event_type | message_text`.
4. Skips events whose hash is already in `ghl_message_sync` (migration `002_ghl_sync.sql`, unique on `(client_id, event_hash)`) unless `--force`.
5. Skips events with neither email nor phone.
6. Upserts the GHL contact, then posts the comment when `--live`.
7. Records the hash with `sync_mode` = `dry-run` or the message type.

Two safety properties, and one honest caveat:

- **External sends are refused by default.** Any `--message-type` other than `InternalComment` requires the explicit `--unsafe-external-send` flag, so the script cannot accidentally text or email leads.
- **The hash ledger makes re-runs idempotent** at the event level.
- **Dry-run is not fully read-only.** It skips posting the message but **still calls `POST /contacts/upsert`**, so contacts are created/updated in GHL even in dry-run. Point it at a test location the first time.

Mode also responds to `GHL_SYNC_MODE=live` in env, not just `--live`.

---

## 8. Adding a new direct adapter

1. Implement `CrmAdapter` in `lib/crm/<provider>.ts` as a factory taking config and an **injectable request function** (mirror `ghl.ts` — that is what makes it testable offline).
2. Add or update the entry in `CRM_PROVIDER_DEFINITIONS` with `path: "direct_adapter"` and `directAdapter: "<key>"`, plus aliases users might type.
3. Extend the `switch` in `lib/crm/index.ts`, returning `null` when credentials are missing.
4. Add `listImportableLeads` only if the provider really supports paging — `hasCrmImport()` detects it automatically.
5. Add a test alongside `tests/ts/ghlAdapter.test.ts` asserting request paths and payloads with a fake request function. No network in tests.
