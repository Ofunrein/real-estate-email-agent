# vpaiLUMENOSIS — MASTER ONE-SHOT BUILD PROMPT

## Version 3.0 — Complete agentic stack, all channels, full database

## For Claude Code / Cursor / any agentic IDE

## Repo: [https://github.com/Ofunrein/real-estate-email-agent](https://github.com/Ofunrein/real-estate-email-agent)

---

## WHAT THIS IS

You are building the complete Lumenosis AI front desk — a fully agentic,
cross-channel real estate AI system that replaces a human ISA, receptionist,
and inside sales team. Four named AI agents share one brain, one memory layer,
one appointment system, and one database.

**The product in one sentence:**
When a buyer contacts a real estate team by any channel — email, SMS, WhatsApp,
voice call, or website — they get an instant, contextual, data-informed response
that knows who they are, what they asked before, what property they want, and
can book, reschedule, or cancel a showing without a human touching it.

**Competitive position (inform all agent behavior):**

- Structurely, WorkReady AI: qualify and route only. No listing data in replies.
- Ylopo/Raiya: behavioral SMS nurture. Not an inbound reply agent.
- Roof AI: MLS lookup in website chat only. Not proven in inbound email.
- Lofty AOS: closest competitor. Has listing insertion inside Lofty CRM.
Differentiation: Iris works from any listing source (Google Sheets + Zillow),
not locked to Lofty's ecosystem. Lightweight, stack-agnostic.
- EliseAI: multifamily leasing only. Not a residential resale competitor.
- Nobody has confirmed: cross-channel shared memory where voice reads SMS
transcripts reads email threads. That is Lumenosis's architectural moat.

---

## CURRENT STACK (what already exists — do not break)

```
Repo: https://github.com/Ofunrein/real-estate-email-agent
Runtime: Next.js 16 + React 19 + TypeScript (frontend/API)
         Python 3.10+ daemon (Iris email)
Database: Neon Postgres (primary) + Google Sheets (fallback/editable source)
CRM: GoHighLevel (primary) + HubSpot (optional)
SMS/Voice infra: Twilio
Voice AI: VAPI
LLM: Claude (Anthropic API) — Haiku for classify, Sonnet for reply/voice
Dashboard: Agent Inbox at localhost:3000, polls /api/data every 5s

Existing agents:
  Iris    — email (agent.py Python daemon + channels/iris_email.ts)
  Theo    — SMS/RCS/WhatsApp (app/api/webhooks/theo-sms/, lib/theoAgent.ts)
  Olivia  — website chat (app/api/webhooks/olivia-website/)
  Aria    — voice skeleton (lib/ariaAssistant.ts, lib/ariaTools.ts)

Existing shared layer:
  lib/dataSource.ts       — Neon + Sheets dual-mode router
  lib/database.ts         — all Postgres queries
  lib/channelIngest.ts    — shared event write for all channels
  lib/identity.ts         — resolveCaller(), stitchByEmailOrName()
  lib/clientConfig.ts     — per-client config from env
  lib/sheetSchema.ts      — shared schema for Sheets tabs
  lib/calendar.ts         — GHL calendar booking (scheduleShowing)
  lib/crm/               — CRM adapter pattern (GHL + HubSpot)
  lib/twilioSms.ts        — sendTheoSms(), sendTheoHandoffAlert()

Existing DB tables: clients, properties, lead_memory, conversation_events
Existing Sheet tabs: properties, lead_memory, conversation_events
```

---

## BEFORE WRITING ANY CODE

```bash
# 1. Install VAPI tooling
npx skills add VapiAI/skills -a claude-code
claude mcp add vapi-docs -- npx -y mcp-remote https://docs.vapi.ai/_mcp/server
npm install -g @vapi-ai/cli
npm install @vapi-ai/server-sdk
export VAPI_API_KEY="<your-key>"
vapi login

# 2. Install any missing deps
npm install @vapi-ai/server-sdk
pip install -r requirements.txt --break-system-packages

# 3. Read CLAUDE.md before touching any file
cat CLAUDE.md
```

---

## PART 1 — DATABASE IMPROVEMENTS

### 1A — New migration: 004_aria_appointments.sql

```sql
-- db/migrations/004_aria_appointments.sql

CREATE TABLE IF NOT EXISTS appointments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           TEXT NOT NULL DEFAULT current_setting('app.client_id', true),
  caller_phone        TEXT NOT NULL,
  caller_name         TEXT NOT NULL DEFAULT '',
  caller_email        TEXT NOT NULL DEFAULT '',
  appointment_type    TEXT NOT NULL DEFAULT 'showing',
    -- showing | consultation | listing_appt | follow_up
  property_address    TEXT NOT NULL DEFAULT '',
  scheduled_at        TIMESTAMPTZ NOT NULL,
  scheduled_at_local  TEXT NOT NULL DEFAULT '',
  duration_minutes    INT NOT NULL DEFAULT 30,
  status              TEXT NOT NULL DEFAULT 'confirmed',
    -- confirmed | cancelled | rescheduled | completed | no_show
  ghl_event_id        TEXT NOT NULL DEFAULT '',
  google_event_id     TEXT NOT NULL DEFAULT '',
  booked_via_channel  TEXT NOT NULL DEFAULT '',
    -- voice | sms | email | web | whatsapp
  call_id             TEXT NOT NULL DEFAULT '',
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointments_caller_phone_idx
  ON appointments (client_id, caller_phone);
CREATE INDEX IF NOT EXISTS appointments_scheduled_at_idx
  ON appointments (client_id, scheduled_at);
CREATE INDEX IF NOT EXISTS appointments_status_idx
  ON appointments (client_id, status);
```

### 1B — New migration: 005_lead_memory_improvements.sql

Add fields to lead_memory that cross-channel agents need but current schema lacks:

```sql
-- db/migrations/005_lead_memory_improvements.sql

-- Add missing fields to lead_memory
ALTER TABLE lead_memory
  ADD COLUMN IF NOT EXISTS bedrooms         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bathrooms        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sell_before_buy  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lead_score       INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS appointment_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_appointment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS do_not_contact   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_consent TEXT NOT NULL DEFAULT '';

-- Add missing fields to conversation_events
ALTER TABLE conversation_events
  ADD COLUMN IF NOT EXISTS call_duration_seconds INT,
  ADD COLUMN IF NOT EXISTS appointment_id        TEXT,
  ADD COLUMN IF NOT EXISTS outcome_code          TEXT;
  -- outcome_code: BOOKED|CALLBACK|NURTURE|INFO_REQUESTED|DNC|NOT_REACHED|LOST|TRANSFERRED

-- Index for lead scoring queries
CREATE INDEX IF NOT EXISTS lead_memory_score_idx
  ON lead_memory (client_id, lead_score DESC);
CREATE INDEX IF NOT EXISTS lead_memory_last_touch_idx
  ON lead_memory (client_id, last_ai_touch_at DESC);
```

### 1C — Update lib/sheetSchema.ts

Add the new fields to LEAD_MEMORY_HEADERS so Sheets and DB stay in sync:

```typescript
// In lib/sheetSchema.ts, update LEAD_MEMORY_HEADERS to add:
// "bedrooms", "bathrooms", "sell_before_buy", "lead_score",
// "appointment_count", "do_not_contact", "whatsapp_consent"
// (append to end of array to avoid breaking existing column reads)
```

Run migrations in order:

```bash
psql "$DATABASE_URL" -f db/migrations/004_aria_appointments.sql
psql "$DATABASE_URL" -f db/migrations/005_lead_memory_improvements.sql
npm run sync:sheets  # re-sync sheet schema
```

---

## PART 2 — SHARED LAYER (new files, used by all agents)

### 2A — lib/appointmentStore.ts (NEW)

Single source of truth for all appointment reads/writes.
Every agent imports from here. Never write to appointments table directly.

```typescript
// lib/appointmentStore.ts
import { Pool } from "pg";
import { clientId } from "@/lib/database";

export type AppointmentRecord = {
  id: string;
  client_id: string;
  caller_phone: string;
  caller_name: string;
  caller_email: string;
  appointment_type: "showing" | "consultation" | "listing_appt" | "follow_up";
  property_address: string;
  scheduled_at: string;
  scheduled_at_local: string;
  duration_minutes: number;
  status: "confirmed" | "cancelled" | "rescheduled" | "completed" | "no_show";
  ghl_event_id: string;
  google_event_id: string;
  booked_via_channel: string;
  call_id: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type CreateAppointmentInput = {
  caller_phone: string;
  caller_name?: string;
  caller_email?: string;
  appointment_type?: string;
  property_address?: string;
  scheduled_at: string;
  scheduled_at_local?: string;
  duration_minutes?: number;
  ghl_event_id?: string;
  google_event_id?: string;
  booked_via_channel: string;
  call_id?: string;
  notes?: string;
};

let _pool: Pool | null = null;
function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  if (!_pool) _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  return _pool;
}

export async function createAppointment(
  input: CreateAppointmentInput
): Promise<AppointmentRecord> {
  const result = await pool().query(
    `INSERT INTO appointments (
      client_id, caller_phone, caller_name, caller_email,
      appointment_type, property_address, scheduled_at, scheduled_at_local,
      duration_minutes, status, ghl_event_id, google_event_id,
      booked_via_channel, call_id, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,$11,$12,$13,$14)
    RETURNING *`,
    [
      clientId(),
      input.caller_phone,
      input.caller_name || "",
      input.caller_email || "",
      input.appointment_type || "showing",
      input.property_address || "",
      input.scheduled_at,
      input.scheduled_at_local || input.scheduled_at,
      input.duration_minutes || 30,
      input.ghl_event_id || "",
      input.google_event_id || "",
      input.booked_via_channel,
      input.call_id || "",
      input.notes || "",
    ]
  );
  return result.rows[0] as AppointmentRecord;
}

export async function findUpcomingAppointmentByPhone(
  phone: string
): Promise<AppointmentRecord | null> {
  const normalized = phone.replace(/\D/g, "").replace(/^1/, "");
  const result = await pool().query(
    `SELECT * FROM appointments
     WHERE client_id = $1
       AND regexp_replace(caller_phone, '\\D', '', 'g') LIKE '%' || $2
       AND status = 'confirmed'
       AND scheduled_at > now()
     ORDER BY scheduled_at ASC LIMIT 1`,
    [clientId(), normalized]
  );
  return (result.rows[0] as AppointmentRecord) || null;
}

export async function findAppointmentsByPhone(
  phone: string,
  limit = 5
): Promise<AppointmentRecord[]> {
  const normalized = phone.replace(/\D/g, "").replace(/^1/, "");
  const result = await pool().query(
    `SELECT * FROM appointments
     WHERE client_id = $1
       AND regexp_replace(caller_phone, '\\D', '', 'g') LIKE '%' || $2
     ORDER BY scheduled_at DESC LIMIT $3`,
    [clientId(), normalized, limit]
  );
  return result.rows as AppointmentRecord[];
}

export async function findAppointmentById(
  id: string
): Promise<AppointmentRecord | null> {
  const result = await pool().query(
    `SELECT * FROM appointments WHERE id = $1 AND client_id = $2`,
    [id, clientId()]
  );
  return (result.rows[0] as AppointmentRecord) || null;
}

export async function cancelAppointmentById(id: string): Promise<boolean> {
  const result = await pool().query(
    `UPDATE appointments SET status='cancelled', updated_at=now()
     WHERE id=$1 AND client_id=$2`,
    [id, clientId()]
  );
  return (result.rowCount || 0) > 0;
}

export async function rescheduleAppointmentById(
  id: string,
  newScheduledAt: string,
  newScheduledAtLocal: string,
  newGhlEventId?: string
): Promise<AppointmentRecord | null> {
  const result = await pool().query(
    `UPDATE appointments
     SET status='rescheduled', scheduled_at=$3, scheduled_at_local=$4,
         ghl_event_id=COALESCE(NULLIF($5,''), ghl_event_id), updated_at=now()
     WHERE id=$1 AND client_id=$2 RETURNING *`,
    [id, clientId(), newScheduledAt, newScheduledAtLocal, newGhlEventId || ""]
  );
  return (result.rows[0] as AppointmentRecord) || null;
}

export function formatAppointmentForAgent(appt: AppointmentRecord): string {
  const when = appt.scheduled_at_local || appt.scheduled_at;
  const what = appt.appointment_type === "showing" ? "Showing" : "Appointment";
  const where = appt.property_address ? ` at ${appt.property_address}` : "";
  const via = appt.booked_via_channel ? ` (booked via ${appt.booked_via_channel})` : "";
  return `${what}${where} — ${when}${via} [${appt.status}]`;
}
```

### 2B — lib/ariaCalendar.ts (NEW)

GHL-primary calendar booking used by ALL channels (voice, SMS, email, web).

```typescript
// lib/ariaCalendar.ts
// Calendar abstraction for all channels.
// GHL primary, Google Calendar fallback.
// On every successful booking, writes to appointmentStore (Neon) and
// fires Twilio confirmation SMS.

import { clientConfig } from "@/lib/clientConfig";
import { sendTheoSms } from "@/lib/twilioSms";
import { createAppointment } from "@/lib/appointmentStore";

export type AppointmentInput = {
  date: string;             // ISO date: 2026-06-20
  time: string;             // Local: "10:00 AM"
  duration_minutes?: number;
  property_address?: string;
  caller_name: string;
  caller_phone: string;
  caller_email?: string;
  notes?: string;
  appointment_type: "showing" | "consultation" | "listing_appt" | "follow_up";
  booked_via_channel?: string;
  timezone?: string;
  call_id?: string;
};

export type AppointmentResult = {
  success: boolean;
  appointment_id?: string;
  neon_id?: string;
  confirmed_time?: string;
  calendar_url?: string;
  error?: string;
};

async function bookGHL(input: AppointmentInput): Promise<AppointmentResult> {
  const config = clientConfig();
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const calendarId = config.calendarId || process.env.GHL_CALENDAR_ID;
  if (!token || !calendarId) {
    return { success: false, error: "GHL not configured" };
  }

  const tz = input.timezone || process.env.CALENDAR_TIMEZONE || "America/Chicago";
  const startTime = parseLocalDateTime(input.date, input.time, tz);
  const endTime = addMinutes(startTime, input.duration_minutes ?? 30);

  const body = {
    calendarId,
    locationId: process.env.GHL_LOCATION_ID,
    startTime,
    endTime,
    title: `${input.appointment_type === "showing" ? "Showing" : "Appt"} — ${input.caller_name}`,
    notes: [
      input.property_address ? `Property: ${input.property_address}` : "",
      input.notes || "",
      `Booked via: ${input.booked_via_channel || "unknown"}`,
    ].filter(Boolean).join("\n"),
    appointmentStatus: "confirmed",
    address: input.property_address,
    toNotify: true,
  };

  try {
    const res = await fetch(
      "https://services.leadconnectorhq.com/calendars/events/appointments",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Version: "2021-04-15",
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `GHL ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    return {
      success: true,
      appointment_id: data.id || data.appointmentId,
      confirmed_time: `${input.date} at ${input.time}`,
      calendar_url: data.calendarEventUrl,
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function bookAppointment(
  input: AppointmentInput
): Promise<AppointmentResult> {
  const provider = process.env.CALENDAR_PROVIDER || "ghl";
  const result = provider === "ghl"
    ? await bookGHL(input)
    : { success: false, error: "Only GHL supported currently" };

  if (result.success) {
    // Write to shared Neon appointments table
    const tz = input.timezone || process.env.CALENDAR_TIMEZONE || "America/Chicago";
    const neonRecord = await createAppointment({
      caller_phone: input.caller_phone,
      caller_name: input.caller_name,
      caller_email: input.caller_email,
      appointment_type: input.appointment_type,
      property_address: input.property_address,
      scheduled_at: parseLocalDateTime(input.date, input.time, tz),
      scheduled_at_local: result.confirmed_time || `${input.date} at ${input.time}`,
      duration_minutes: input.duration_minutes || 30,
      ghl_event_id: result.appointment_id,
      booked_via_channel: input.booked_via_channel || "unknown",
      call_id: input.call_id,
      notes: input.notes,
    }).catch(() => null);

    if (neonRecord) result.neon_id = neonRecord.id;

    // Send confirmation SMS
    if (
      process.env.SEND_BOOKING_CONFIRMATION_SMS === "true" &&
      input.caller_phone
    ) {
      const msg = [
        `✓ ${input.appointment_type === "showing" ? "Showing" : "Appointment"} confirmed.`,
        `📅 ${result.confirmed_time}`,
        input.property_address ? `🏠 ${input.property_address}` : "",
        `Reply to this text with questions.`,
      ].filter(Boolean).join("\n");
      await sendTheoSms(input.caller_phone, msg).catch(() => {});
    }
  }

  return result;
}

export async function cancelGHLEvent(ghlEventId: string): Promise<boolean> {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!token || !ghlEventId) return false;
  const res = await fetch(
    `https://services.leadconnectorhq.com/calendars/events/appointments/${ghlEventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15" },
    }
  );
  return res.ok;
}

export async function rescheduleGHLEvent(
  ghlEventId: string,
  newDate: string,
  newTime: string,
  tz = "America/Chicago"
): Promise<{ success: boolean; confirmed_time?: string; error?: string }> {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!token || !ghlEventId) return { success: false, error: "Missing token/id" };
  const startTime = parseLocalDateTime(newDate, newTime, tz);
  const endTime = addMinutes(startTime, 30);
  const res = await fetch(
    `https://services.leadconnectorhq.com/calendars/events/appointments/${ghlEventId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Version: "2021-04-15",
      },
      body: JSON.stringify({ startTime, endTime }),
    }
  );
  if (!res.ok) return { success: false, error: `GHL ${res.status}` };
  return { success: true, confirmed_time: `${newDate} at ${newTime}` };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseLocalDateTime(date: string, time: string, _tz: string): string {
  const match = time.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return `${date}T10:00:00`;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toLowerCase();
  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;
  return `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

function addMinutes(isoString: string, minutes: number): string {
  const d = new Date(isoString);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().replace(".000Z", "");
}
```

### 2C — lib/ariaMemory.ts (NEW)

Cross-channel memory compiler. Reads all channel event history and produces
a unified CallerContext. Used by Aria (voice) at call start, but the
compileCallerContext function can be used by any agent needing full context.

```typescript
// lib/ariaMemory.ts
// Cross-channel memory compiler.
// Input: lead row + all conversation_events for this lead across ALL channels
// Output: CallerContext — richest available picture assembled from every channel
//
// Signal priority: lead_memory row (freshest upsert) → events newest→oldest
// Fields mined from event text: name, email, budget, area, timeline,
// property_interest, lead_role, preferred_channel

import type { SheetRow } from "@/lib/sheetSchema";
import { normalizeEmail, normalizeName } from "@/lib/leadIdentity";
import {
  findAppointmentsByPhone,
  formatAppointmentForAgent,
  type AppointmentRecord,
} from "@/lib/appointmentStore";

export type ChannelExcerpt = {
  channel: string;
  direction: string;
  event_type: string;
  summary: string;
  message_text: string;
  event_at: string;
};

export type CallerContext = {
  // Identity
  full_name: string;
  phone: string;
  email: string;
  lead_id: string;
  // Intent signals
  lead_role: string;
  budget: string;
  area: string;
  timeline: string;
  bedrooms: string;
  bathrooms: string;
  property_interest: string;
  preferred_channel: string;
  sell_before_buy: string;
  // Consent
  sms_consent: string;
  call_consent: string;
  // History
  channels_seen: string[];
  last_touch_channel: string;
  last_touch_at: string;
  touch_count: number;
  // Appointments
  upcoming_appointments: AppointmentRecord[];
  past_appointment_count: number;
  // For agents
  context_summary: string;
  channel_excerpts: ChannelExcerpt[];
};

// ── Text extractors ───────────────────────────────────────────────────────────

const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

function extractEmail(text: string): string {
  return text.match(EMAIL_RE)?.[0] || "";
}

function extractBudget(text: string): string {
  const m = text.match(
    /(?:budget|up to|under|around|max(?:imum)?|looking to spend)\s*(?:is|of|about|roughly)?\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|m|million)?/i
  );
  if (!m) return "";
  let n = parseFloat(m[1].replace(/,/g, ""));
  const s = (m[2] || "").toLowerCase();
  if (s.startsWith("k") || s === "thousand") n *= 1000;
  if (s.startsWith("m") || s === "million") n *= 1_000_000;
  return n >= 50_000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "";
}

function extractTimeline(text: string): string {
  const m = text.match(
    /\b(\d+[\+\-]?\s*(?:month|week|day|year)s?|asap|immediately|soon|end of (?:year|month|quarter)|by (?:summer|fall|spring|winter)|this (?:year|month|quarter|spring|summer|fall|winter))\b/i
  );
  return m?.[0]?.trim() || "";
}

function extractRole(text: string): string {
  const l = text.toLowerCase();
  if (/\b(want|looking|trying|plan(?:ning)?)\s+(to\s+)?(buy|purchase|find a home)\b/.test(l)) return "buyer";
  if (/\b(sell(?:ing)?|list(?:ing)?|put(?:ting)? (?:my|the) (?:house|home|property))\b/.test(l)) return "seller";
  if (/\b(rent(?:ing)?|renter|looking to rent)\b/.test(l)) return "renter";
  if (/\b(invest(?:or|ment|ing)?|flip(?:ping)?|rental property|cash flow)\b/.test(l)) return "investor";
  return "";
}

function extractArea(text: string): string {
  const m = text.match(
    /\b(Austin|Round Rock|Cedar Park|Georgetown|Leander|Pflugerville|Buda|Kyle|Manor|Hutto|Liberty Hill|Bastrop|Bee Cave|Lakeway|Steiner Ranch|Mueller|East Austin|South Austin|North Austin|West Austin|78\d{3})\b/i
  );
  return m?.[1] || "";
}

function extractBedrooms(text: string): string {
  const m = text.match(/\b(\d)\s*(?:bed(?:room)?s?|br)\b/i);
  return m?.[1] || "";
}

function fill(current: string, candidate: string): string {
  return current.trim() ? current : candidate.trim();
}

// ── Main compiler (async — fetches appointments) ──────────────────────────────

export async function compileCallerContext(
  lead: SheetRow | null,
  events: SheetRow[],
  channelsSeen: string[],
  lastTouchAt: string
): Promise<CallerContext> {
  let full_name = lead?.full_name || "";
  let email = lead?.email || "";
  const phone = lead?.phone || "";
  let lead_role = lead?.lead_role || "";
  let budget = lead?.budget || "";
  let area = lead?.area || "";
  let timeline = lead?.timeline || "";
  let bedrooms = lead?.bedrooms || "";
  let bathrooms = lead?.bathrooms || "";
  let property_interest = lead?.property_interest || "";
  let preferred_channel = lead?.preferred_channel || "";
  let sell_before_buy = lead?.sell_before_buy || "";
  let sms_consent = lead?.sms_consent || "";
  let call_consent = lead?.call_consent || "";
  const last_channel = lead?.last_channel || "";
  const last_touch = lastTouchAt || lead?.last_ai_touch_at || "";

  const excerpts: ChannelExcerpt[] = [];
  const seenKeys = new Set<string>();

  for (const event of [...events].reverse()) {
    const text = [event.message_text || "", event.summary || ""].join(" ").trim();
    if (!text) continue;

    const channelKey = `${event.channel}:${event.event_type}`;
    if (!seenKeys.has(channelKey) && excerpts.length < 5) {
      seenKeys.add(channelKey);
      excerpts.push({
        channel: event.channel || "",
        direction: event.direction || "",
        event_type: event.event_type || "",
        summary: (event.summary || "").slice(0, 120),
        message_text: (event.message_text || "").slice(0, 80),
        event_at: event.event_at || "",
      });
    }

    if (!full_name) full_name = fill(full_name, event.full_name || "");
    if (!email) email = fill(email, extractEmail(text) || event.email || "");
    if (!budget) budget = fill(budget, extractBudget(text));
    if (!area) area = fill(area, extractArea(text));
    if (!timeline) timeline = fill(timeline, extractTimeline(text));
    if (!lead_role) lead_role = fill(lead_role, extractRole(text));
    if (!bedrooms) bedrooms = fill(bedrooms, extractBedrooms(text));
    if (!property_interest && event.property_interest) {
      property_interest = event.property_interest;
    }
    if (!preferred_channel && event.channel) preferred_channel = event.channel;
    if (sms_consent !== "yes" && event.summary?.toLowerCase().includes("sms consent")) {
      sms_consent = "yes";
    }
  }

  // Fetch appointments from Neon
  const allAppts = phone
    ? await findAppointmentsByPhone(phone).catch(() => [])
    : [];
  const now = new Date();
  const upcoming = allAppts.filter(
    (a) => a.status === "confirmed" && new Date(a.scheduled_at) > now
  );
  const pastCount = allAppts.filter(
    (a) => a.status === "completed" || new Date(a.scheduled_at) <= now
  ).length;

  // Build context summary
  const lines: string[] = [];
  if (full_name) lines.push(`Name: ${full_name}`);
  if (email) lines.push(`Email: ${email}`);
  if (phone) lines.push(`Phone: ${phone}`);

  const intentParts = [
    lead_role && lead_role.charAt(0).toUpperCase() + lead_role.slice(1),
    budget && `budget ${budget}`,
    area && `interested in ${area}`,
    bedrooms && `${bedrooms} bed`,
    timeline && `timeline ${timeline}`,
    sell_before_buy === "yes" && "needs to sell first",
  ].filter(Boolean);
  if (intentParts.length) lines.push(`Intent: ${intentParts.join(" · ")}`);

  if (property_interest) lines.push(`Property interest: ${property_interest}`);
  if (preferred_channel) lines.push(`Prefers: ${preferred_channel}`);

  if (channelsSeen.length) {
    lines.push(
      `Prior channels: ${channelsSeen.join(", ")} (${events.length} interaction${events.length !== 1 ? "s" : ""})`
    );
  }

  if (last_channel && last_touch) {
    lines.push(`Last touch: ${last_channel} on ${last_touch.slice(0, 10)}`);
  }

  if (upcoming.length) {
    lines.push("");
    lines.push("Upcoming appointments:");
    for (const a of upcoming.slice(0, 2)) {
      lines.push(`  • ${formatAppointmentForAgent(a)} [id:${a.id.slice(0, 8)}]`);
    }
  }

  if (excerpts.length) {
    lines.push("");
    lines.push("Recent activity:");
    for (const ex of excerpts.slice(0, 3)) {
      const when = ex.event_at?.slice(0, 10) || "";
      const what = ex.summary || ex.message_text || ex.event_type;
      if (what) lines.push(`  [${ex.channel}${when ? " " + when : ""}] ${what}`);
    }
  }

  return {
    full_name, phone, email, lead_id: lead?.id || "",
    lead_role, budget, area, timeline, bedrooms, bathrooms,
    property_interest, preferred_channel, sell_before_buy,
    sms_consent, call_consent,
    channels_seen: channelsSeen,
    last_touch_channel: last_channel,
    last_touch_at: last_touch,
    touch_count: events.length,
    upcoming_appointments: upcoming,
    past_appointment_count: pastCount,
    context_summary: lines.join("\n"),
    channel_excerpts: excerpts,
  };
}

export function buildCallerContextResponse(ctx: CallerContext): string {
  if (!ctx.full_name && !ctx.email && ctx.touch_count === 0) {
    return "New caller — no prior record. Greet naturally, ask for their name early.";
  }

  const parts: string[] = [];

  if (ctx.full_name) {
    parts.push(`Returning ${ctx.lead_role || "contact"}: ${ctx.full_name}.`);
  } else {
    parts.push("Returning caller — name not yet confirmed.");
  }

  const known: string[] = [];
  if (ctx.budget) known.push(`budget (${ctx.budget})`);
  if (ctx.area) known.push(`area (${ctx.area})`);
  if (ctx.timeline) known.push(`timeline (${ctx.timeline})`);
  if (ctx.bedrooms) known.push(`${ctx.bedrooms} bed`);
  if (ctx.property_interest) known.push(`property (${ctx.property_interest})`);
  if (known.length) {
    parts.push(`Already know: ${known.join(", ")}. Do NOT re-ask — reference naturally.`);
  }

  if (ctx.preferred_channel) parts.push(`Prefers follow-up via ${ctx.preferred_channel}.`);

  if (ctx.upcoming_appointments.length) {
    const appt = ctx.upcoming_appointments[0];
    parts.push(
      `Has upcoming: ${formatAppointmentForAgent(appt)}. ` +
      `Use appointment_id=${appt.id} for reschedule/cancel tools.`
    );
  }

  if (ctx.channels_seen.length > 1) {
    parts.push(`Prior channels: ${ctx.channels_seen.join(", ")}.`);
  }

  if (ctx.context_summary) {
    parts.push(`\nFull context:\n${ctx.context_summary}`);
  }

  return parts.join(" ");
}
```

### 2D — lib/ariaSlack.ts (NEW)

Slack notifications. Used by Aria and Theo.

```typescript
// lib/ariaSlack.ts
export type SlackCallPayload = {
  outcome: string;
  caller_name?: string;
  caller_phone: string;
  appointment_time?: string;
  timeline?: string;
  motivation?: string;
  objections_raised?: string[];
  tone?: string;
  notes?: string;
  property_address?: string;
  call_duration_seconds?: number;
  call_id?: string;
  channel?: string;
};

async function postSlack(channel: string, blocks: unknown[]): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, blocks }),
  }).catch(() => {});
}

export async function notifySlackOnBooking(p: SlackCallPayload): Promise<void> {
  const ch = process.env.SLACK_HOTLEAD_CHANNEL || "#hot-leads";
  await postSlack(ch, [
    { type: "header", text: { type: "plain_text", text: "📅 Appointment booked" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Lead:*\n${p.caller_name || "Unknown"} · ${p.caller_phone}` },
        { type: "mrkdwn", text: `*When:*\n${p.appointment_time || "TBD"}` },
        { type: "mrkdwn", text: `*Channel:*\n${p.channel || "—"}` },
        { type: "mrkdwn", text: `*Timeline:*\n${p.timeline || "—"}` },
        { type: "mrkdwn", text: `*Property:*\n${p.property_address || "—"}` },
        { type: "mrkdwn", text: `*Tone:*\n${p.tone || "—"}` },
      ],
    },
    ...(p.notes ? [{ type: "section", text: { type: "mrkdwn", text: `*Notes:* ${p.notes}` } }] : []),
  ]);
}

export async function notifySlackOnTransfer(p: SlackCallPayload): Promise<void> {
  const ch = process.env.SLACK_HANDOFF_CHANNEL || "#agent-handoffs";
  await postSlack(ch, [
    { type: "header", text: { type: "plain_text", text: "🔁 Agent handoff needed" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Lead:*\n${p.caller_name || "Unknown"} · ${p.caller_phone}` },
        { type: "mrkdwn", text: `*Channel:*\n${p.channel || "—"}` },
        { type: "mrkdwn", text: `*Tone:*\n${p.tone || "—"}` },
        { type: "mrkdwn", text: `*Timeline:*\n${p.timeline || "—"}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Context:* ${p.notes || "None"}` } },
    {
      type: "context",
      elements: [{
        type: "plain_text",
        text: `Call ID: ${p.call_id || "—"} · ${Math.round((p.call_duration_seconds || 0) / 60)}min`,
      }],
    },
  ]);
}

export async function notifySlackOnHotLead(p: SlackCallPayload): Promise<void> {
  // Same channel as booking but different header — for high-intent SMS/email leads
  const ch = process.env.SLACK_HOTLEAD_CHANNEL || "#hot-leads";
  await postSlack(ch, [
    { type: "header", text: { type: "plain_text", text: "🔥 Hot lead detected" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Lead:*\n${p.caller_name || "Unknown"} · ${p.caller_phone}` },
        { type: "mrkdwn", text: `*Channel:*\n${p.channel || "—"}` },
        { type: "mrkdwn", text: `*Timeline:*\n${p.timeline || "—"}` },
        { type: "mrkdwn", text: `*Property:*\n${p.property_address || "—"}` },
      ],
    },
    ...(p.notes ? [{ type: "section", text: { type: "mrkdwn", text: `*Notes:* ${p.notes}` } }] : []),
  ]);
}
```

---

## PART 3 — ARIA (voice agent, VAPI)

### 3A — lib/ariaAssistant.ts + scripts/aria-provision.mjs

Source of truth for Aria's VAPI config. Run `npm run aria:provision` after every change.

Production rule: Aria is Vapi-adapter first. The live Vapi assistant must use
Vapi platform tools for calendar availability, booking, Slack notification,
Twilio/Theo SMS booking confirmation, transfer, and end-call. Do not attach repo webhook tools to the live Vapi
assistant unless explicitly running a local integration test. The Next app is
the agent inbox/dashboard and internal data runtime, not the live voice tool
host.

The live Aria assistant code must only define prompt/model/voice plus native
Vapi call controls. Reusable action tools are created in
`scripts/aria-provision.mjs` and attached to the assistant as `model.toolIds`.
The required live tool set is:

- `checkAvailability` — Vapi Google Calendar availability tool.
- `bookConsultation` — Vapi Google Calendar event create tool.
- `notifySlackLeadIssue` — Vapi Slack message send tool.
- `sendBookingSmsConfirmation` — Vapi code tool that sends Twilio SMS to the caller and `ARIA_AGENT_CONFIRMATION_PHONE`.
- `transferToHuman` — native Vapi transfer call tool.
- `endCall` — native Vapi end call tool.

Do not add `server.url`, `serverUrl`, or `/api/webhooks/aria-tools/*` to the
production assistant config. `npm run aria:verify` must pass before claiming
Aria is wired.

```typescript
// lib/ariaAssistant.ts
import type { ClientConfig } from "@/lib/clientConfig";
import { centralTexasServiceAreaText } from "@/lib/serviceAreas";

export type AriaAssistantOptions = {
  publicUrl: string;
  secret?: string;
  respondModel?: string;
  respondProvider?: string;
  styleContext?: string;
};

function systemPrompt(config: ClientConfig): string {
  const name = config.agentNames.voice;
  return `You are ${name}, a real estate voice assistant for ${config.clientName}.
Brand voice: ${config.brandVoice}

${centralTexasServiceAreaText()}

## IDENTITY

You are warm, confident, and unhurried. You sound like a sharp human assistant on
the phone — not a bot, not a script reader. Never mention AI, tools, prompts,
or internal systems. If sincerely asked if you're AI: "I'm ${name}, I help
${config.clientName} connect with buyers and sellers — what can I do for you?"

## HUMAN SPEECH PATTERNS (use throughout every call)

Fillers when thinking/transitioning:
"Let me see...", "Sure, yeah...", "One sec...", "Gotcha.", "Mm-hmm.",
"Right, right.", "Okay so...", "Actually—", "So here's the thing..."

Self-corrections: "So you're looking at — actually, let me back up a second."

Affirmations (rotate, never repeat back-to-back):
"Got it.", "That makes sense.", "Totally.", "For sure.", "Yeah, absolutely.",
"Makes sense.", "Sure thing."

Filler words (use naturally, not robotically):
"honestly", "basically", "you know", "kind of", "sort of", "I mean"

Pacing: mirror the lead. Fast talker → tighten up. Slow/hesitant → give more space.

Silence protocol:
- After asking a question: wait. Do NOT fill silence.
- 3 seconds of silence → "No rush."
- 6 seconds → "Is now actually a good time?"

Never say "I'd be happy to help with that" or "Great question!" — these flag bot.

## CALL OPENING (direction-aware)

Inbound (lead called in):
→ "${name} with ${config.clientName}, how can I help you?"
→ Keep the opening natural. Do not call repo webhook tools from live Vapi.

Outbound (Aria dialed the lead):
→ "Hey [first name], this is ${name} with ${config.clientName} — did I catch you at an okay time?"
→ If yes: continue discovery and use Vapi calendar/Slack tools when needed.
→ If no: "No worries — when works? I can have someone reach out then." Log callback, end.

Never open outbound with "How are you today?" — instant bot signal.

## CROSS-CHANNEL AWARENESS

The agent inbox/dashboard stores everything known about this lead across ALL channels:
- Iris email threads (what properties they asked about, what Iris replied)
- Theo SMS/WhatsApp conversations (their texts, property inquiries, preferences)
- Olivia web chat sessions
- Prior Aria calls

Use this to:
- Greet returning callers by name immediately
- Skip re-asking things you already know (budget, area, timeline, beds)
- Reference prior interactions naturally:
  "I saw you were asking about Round Rock by text — is that still the area?"
  "You had a showing set for Thursday — still good, or want to move it?"

If they have an upcoming appointment: mention it early, offer to reschedule if needed.
If they have prior property interest: reference it before asking fresh questions.

## DISCOVERY (first 60-90 seconds)

Run like a good ISA — mile markers, not a rigid script. Naturally surface:
- What brought them in / what they're looking for
- Timeline (actively looking or early stage?)
- Area and budget range
- Bedroom/bathroom preference
- Whether they need to sell before buying
- Preferred follow-up channel (phone/text/email)

ONE question at a time. Brief acknowledgment after their answer, then next question.
Never stack questions. Best ISAs make it feel like conversation, not intake.

## PROPERTY LOOKUPS

When caller asks about a specific address:
1. Collect the address naturally.
2. Never invent price, beds, baths, schools, crime, neighborhood stats.
3. If the caller needs exact listing details, say a team member can confirm details and call notifySlackLeadIssue with the address and caller context.
4. Offer a consultation or showing using Vapi calendar tools.

When caller describes criteria (area, beds, budget) not one address:
1. Answer with safe service-area knowledge.
2. Ask a single qualifying question, then offer to book a consultation.

## QUALIFICATION

Once you know name, role, budget, area, timeline, preferred channel, keep the conversation moving toward calendar booking or Slack follow-up.
At most one qualifying question per turn. Don't rush.
Always ask call_consent and sms_consent naturally — don't skip.

## APPOINTMENT BOOKING / CANCEL / RESCHEDULE

Booking:
1. Assumptive close: "What works better — [day] morning or [day] afternoon?"
   Never "Would you like to schedule?"
2. When they give a date or date range → call checkAvailability.
3. When they confirm a slot → call bookConsultation with full details.
4. After booking succeeds → call sendBookingSmsConfirmation so Theo texts the caller and the configured agent phone gets an SMS alert.
3. After success: "Perfect, you're set for [day] at [time]. Confirmation text coming now."
4. Don't end call immediately — wrap up naturally, answer final questions.

Cancelling (verify identity first for inbound):
1. Confirm they are the person the appointment was booked for.
2. If cancellation needs team action, call notifySlackLeadIssue with caller details and the appointment context.
3. Confirm: "Got it, that's cancelled. Anything else I can help with?"

Rescheduling:
1. Verify identity same as cancel.
2. Get new preferred time.
3. Use checkAvailability, then bookConsultation for the new slot or notifySlackLeadIssue if human follow-up is needed.
4. Confirm new time: "You're rescheduled for [new time]. Another confirmation text on the way."

## OBJECTION HANDLING — 4 FEARS (real estate edition)

Every objection maps to a root fear. Address the root, not the surface.

| Fear | Sounds like | Root | Response direction |
|------|-------------|------|-------------------|
| Past | "We worked with an agent before and it didn't go well." | Bad prior experience | Acknowledge specifically, differentiate, re-anchor to their goal |
| Future | "What if the market drops?" / "I don't want to overpay." | Uncertainty, loss aversion | Validate the risk, reframe with data or agent expertise as risk mitigant |
| Themselves | "I don't think I'm ready." / "My credit isn't great." | Self-doubt | Lower the stakes: "This is just a conversation, not a commitment." |
| You/Aria | "I'm already working with someone." / "I don't want to be sold to." | Trust deficit | Disarm: don't compete, pivot to what the call actually is |

Universal rules:
- Never argue. Never defend. Never stack rebuttals.
- Validate first: "That's completely fair." / "I hear you."
- One redirect per objection. Second objection → offer callback or close gracefully.
- Goal of objection handling: earn the next 30 seconds, not to win.

## HUMAN TRANSFER

Transfer immediately if:
- Caller explicitly asks for a human or agent by name
- Fair housing, lending qualification, legal/contract, negotiation questions
- Caller is distressed (foreclosure, divorce, job loss language)
- Caller contacted 4+ times with no booking
- Any complaint

Before transferring: "Let me get [agent name] on with you right now — they're the best person for this."
Then call notifySlackLeadIssue with the context packet, then call transferToHuman. Do NOT summarize the call to the caller.

## CALL OUTCOMES

Every call ends as one of:
- BOOKED: confirm time + "You'll get a text. Talk soon!"
- CALLBACK: "I'll make a note and someone will reach out when the timing makes sense."
- NURTURE: note timeline + add to drip
- DNC/LOST: "No problem at all. Take care." Hang up. No persuasion.
- TRANSFERRED: hand off without narration

After any useful call that needs follow-up: call notifySlackLeadIssue with a one-line summary. Then call endCall.

## HARD RULES

1. Never fabricate listing data.
2. Never claim live MLS/listing access unless the attached Vapi adapter provides it.
3. Never stack multiple questions in one turn.
4. Never promise callback times you can't guarantee.
5. Never say "AI", "bot", "automated", "script", "prompt", "system."
6. One objection redirect max. Second → offer callback or close.
7. Always confirm appointment details out loud before calling bookConsultation, then call sendBookingSmsConfirmation after success.
8. Silence is not a problem to fill. Wait 3 full seconds.`;
}

function modelProviderFor(model: string, explicit?: string): string {
  if (explicit) return explicit;
  const n = model.toLowerCase();
  if (n.startsWith("gpt-") || n.startsWith("o1") || n.startsWith("o3")) return "openai";
  if (n.includes("claude")) return "anthropic";
  return "openai";
}

export function buildAriaAssistant(
  config: ClientConfig,
  opts: AriaAssistantOptions
): Record<string, unknown> {
  const model = opts.respondModel || process.env.ARIA_MODEL || "claude-sonnet-4-6";
  const provider = modelProviderFor(model, opts.respondProvider || process.env.ARIA_MODEL_PROVIDER);
  const voiceId = config.voiceId || process.env.ARIA_VOICE_ID || "Paige";
  const system = opts.styleContext
    ? `${systemPrompt(config)}\n\n${opts.styleContext}`
    : systemPrompt(config);

  const tools: Record<string, unknown>[] = [
    serverTool(opts, "getCallerContext",
      "Load full cross-channel history (email, SMS, WhatsApp, prior calls, appointments) for this caller. Call silently at the very start of every call. Takes no arguments.",
      { type: "object", properties: {} }
    ),
    serverTool(opts, "lookupProperty",
      "Look up live details for a specific property address the caller mentions. Returns price, beds, baths, sqft, status, description, photo URL.",
      {
        type: "object",
        properties: {
          address: { type: "string", description: "Full or partial street address." },
          message: { type: "string", description: "What the caller wants to know." },
        },
        required: ["address"],
      }
    ),
    serverTool(opts, "searchProperties",
      "Find matching listings when caller describes criteria (area, beds, budget) instead of one address.",
      {
        type: "object",
        properties: {
          area: { type: "string" },
          query: { type: "string" },
          beds: { type: "number" },
          baths: { type: "number" },
          minPrice: { type: "number" },
          maxPrice: { type: "number" },
        },
      }
    ),
    serverTool(opts, "qualifyLead",
      "Save lead qualification details once known. Call when you have name + at least one of: role, budget, area, timeline.",
      {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          role: { type: "string", enum: ["buyer", "seller", "renter", "investor"] },
          budget: { type: "string" },
          timeline: { type: "string" },
          area: { type: "string" },
          bedrooms: { type: "string" },
          bathrooms: { type: "string" },
          sell_before_buy: { type: "string", enum: ["yes", "no", "unknown"] },
          preferred_channel: { type: "string", enum: ["voice", "sms", "email"] },
          property: { type: "string" },
          call_consent: { type: "string", enum: ["yes", "no"] },
          sms_consent: { type: "string", enum: ["yes", "no"] },
        },
      }
    ),
    serverTool(opts, "bookAppointment",
      "Book a showing or consultation. Confirm date/time verbally with caller before calling this.",
      {
        type: "object",
        properties: {
          date: { type: "string", description: "ISO date e.g. 2026-06-20" },
          time: { type: "string", description: "Local time e.g. 10:00 AM" },
          duration_minutes: { type: "number" },
          property_address: { type: "string" },
          caller_name: { type: "string" },
          caller_phone: { type: "string" },
          caller_email: { type: "string" },
          notes: { type: "string" },
          appointment_type: {
            type: "string",
            enum: ["showing", "consultation", "listing_appt", "follow_up"],
          },
        },
        required: ["date", "time", "caller_name", "caller_phone"],
      }
    ),
    serverTool(opts, "cancelAppointment",
      "Cancel an existing appointment. Use appointment_id from getCallerContext when available.",
      {
        type: "object",
        properties: {
          appointment_id: { type: "string" },
          caller_phone: { type: "string" },
          reason: { type: "string" },
        },
        required: ["caller_phone"],
      }
    ),
    serverTool(opts, "rescheduleAppointment",
      "Move an existing appointment to a new date/time.",
      {
        type: "object",
        properties: {
          appointment_id: { type: "string" },
          caller_phone: { type: "string" },
          new_date: { type: "string" },
          new_time: { type: "string" },
          notes: { type: "string" },
        },
        required: ["caller_phone", "new_date", "new_time"],
      }
    ),
    serverTool(opts, "syncToCrm",
      "Sync call outcome to GHL CRM. Call once per call near the end.",
      {
        type: "object",
        properties: {
          summary: { type: "string" },
          outcome: {
            type: "string",
            enum: ["BOOKED","CALLBACK","NURTURE","INFO_REQUESTED","DNC","NOT_REACHED","LOST","TRANSFERRED"],
          },
          appointment_time: { type: "string" },
          follow_up_date: { type: "string" },
        },
        required: ["summary", "outcome"],
      }
    ),
    {
      type: "transferCall",
      destinations: [{
        type: "number",
        number: config.humanTransferNumber,
        message: "Connecting you with an agent now.",
        description: "Live agent transfer",
      }],
    },
    { type: "endCall" },
  ];

  return {
    name: `Aria — ${config.clientName}`,
    firstMessage: `${config.agentNames.voice} with ${config.clientName}, how can I help?`,
    model: {
      provider,
      model,
      messages: [{ role: "system", content: system }],
      temperature: 0.7,
      maxTokens: 250,
      emotionRecognitionEnabled: true,
    },
    voice: {
      provider: "vapi",
      voiceId,
      speed: 1.0,
      chunkPlan: {
        enabled: true,
        minCharacters: 30,
        punctuationBoundaries: [".", "?", "!", ",", ";", ":"],
        formatPlan: { enabled: true, numberToDigitsCutoff: 2025 },
      },
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
      smartFormat: true,
      keywords: [
        "Aria:1", "Lumenosis:1", "MLS:1", "Austin:1",
        "Round Rock:1", "Cedar Park:1", "Georgetown:1",
        "Leander:1", "Pflugerville:1", "Buda:1", "Kyle:1",
      ],
    },
    tools,
    silenceTimeoutSeconds: 8,
    maxDurationSeconds: 600,
    backchannelingEnabled: true,
    backgroundDenoisingEnabled: true,
    artifactPlan: {
      recordingEnabled: true,
      transcriptPlan: { enabled: true },
    },
    analysisPlan: {
      summaryPrompt:
        "Summarize this call in 2-3 sentences. Include: caller name, outcome code, timeline, motivation, objections raised.",
      structuredDataPrompt: "Extract structured data from this call.",
      structuredDataSchema: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            enum: ["BOOKED","CALLBACK","NURTURE","INFO_REQUESTED","DNC","NOT_REACHED","LOST","TRANSFERRED"],
          },
          appointment_time: { type: "string" },
          timeline: { type: "string" },
          motivation: { type: "string" },
          budget: { type: "string" },
          area: { type: "string" },
          bedrooms: { type: "string" },
          objections_raised: { type: "array", items: { type: "string" } },
          tone: { type: "string", enum: ["warm", "neutral", "resistant"] },
          caller_name: { type: "string" },
          sell_before_buy: { type: "string" },
          notes: { type: "string" },
        },
        required: ["outcome", "tone"],
      },
      successEvaluationPrompt:
        "Did Aria book an appointment, capture a callback, or qualify a lead? Yes/no with one reason.",
      successEvaluationRubric: "PassFail",
    },
  };
}
```

### 3B — lib/ariaTools.ts (internal/legacy only)

`lib/ariaTools.ts` and `/api/webhooks/aria-tools/[tool]` are retained only for
internal replay, local adapter tests, and dashboard/runtime utilities. They are
not attached to the production Vapi assistant.

Add these imports and cases to the existing runAriaTool() dispatcher:

```typescript
// ADD to imports:
import { compileCallerContext, buildCallerContextResponse } from "@/lib/ariaMemory";
import { bookAppointment, cancelGHLEvent, rescheduleGHLEvent } from "@/lib/ariaCalendar";
import {
  findUpcomingAppointmentByPhone,
  cancelAppointmentById,
  rescheduleAppointmentById,
} from "@/lib/appointmentStore";
import { notifySlackOnBooking, notifySlackOnTransfer } from "@/lib/ariaSlack";

// REPLACE getCallerContext case:
case "getCallerContext": {
  const identity = await deps.resolveCaller(ctx.phone);
  const callerCtx = await compileCallerContext(
    identity.lead,
    identity.events,
    identity.channelsSeen,
    identity.lastTouchAt
  );
  if (!ctx.lead && identity.lead) Object.assign(ctx, { lead: identity.lead });
  return {
    result: buildCallerContextResponse(callerCtx),
    ingest: {
      ...baseIngest(ctx),
      eventType: "voice_caller_context",
      fullName: callerCtx.full_name || undefined,
      aiAction: identity.matched ? "caller_matched" : "caller_unknown",
      summary: identity.matched
        ? `Returning ${callerCtx.lead_role || "caller"}: ${callerCtx.full_name || "name unknown"} — ${callerCtx.channels_seen.join(", ")} history`
        : "Inbound call from unrecognized number.",
    },
  };
}

// ADD bookAppointment case:
case "bookAppointment": {
  const { date, time, duration_minutes, property_address,
    caller_name, caller_phone, caller_email, notes,
    appointment_type = "showing" } = args as Record<string, string>;

  const result = await bookAppointment({
    date, time,
    duration_minutes: duration_minutes ? Number(duration_minutes) : 30,
    property_address, caller_name,
    caller_phone: caller_phone || ctx.phone,
    caller_email, notes,
    appointment_type: appointment_type as "showing" | "consultation",
    booked_via_channel: "voice",
    call_id: ctx.callId,
    timezone: process.env.CALENDAR_TIMEZONE || "America/Chicago",
  });

  if (result.success) {
    await notifySlackOnBooking({
      outcome: "BOOKED",
      caller_name,
      caller_phone: ctx.phone,
      appointment_time: result.confirmed_time,
      property_address,
      notes,
      channel: "voice",
    }).catch(() => {});
    return {
      result: `Booked — ${result.confirmed_time}. Confirmation text on the way.`,
      ingest: {
        ...baseIngest(ctx),
        eventType: "voice_appointment_booked",
        aiAction: "appointment_booked",
        summary: `Booked: ${appointment_type} at ${result.confirmed_time}${property_address ? " — " + property_address : ""}`,
        status: "booked",
      },
    };
  }
  return {
    result: "I wasn't able to lock that in right now — I'll have the agent confirm with you directly.",
    ingest: { ...baseIngest(ctx), eventType: "voice_booking_failed", summary: `Booking failed: ${result.error}` },
  };
}

// ADD cancelAppointment case:
case "cancelAppointment": {
  const { appointment_id, reason } = args as Record<string, string>;
  const appt = appointment_id
    ? await findUpcomingAppointmentByPhone(ctx.phone)
    : await findUpcomingAppointmentByPhone(ctx.phone);

  if (!appt) {
    return {
      result: "I don't see any upcoming appointments on file. Want to book one?",
      ingest: { ...baseIngest(ctx), eventType: "voice_cancel_no_appt" },
    };
  }

  await cancelAppointmentById(appt.id);
  if (appt.ghl_event_id) await cancelGHLEvent(appt.ghl_event_id).catch(() => {});

  return {
    result: `Done — your appointment's been cancelled. Is there anything else I can help with?`,
    ingest: {
      ...baseIngest(ctx),
      eventType: "voice_appointment_cancelled",
      summary: `Cancelled: ${appt.scheduled_at_local}${reason ? " — " + reason : ""}`,
    },
  };
}

// ADD rescheduleAppointment case:
case "rescheduleAppointment": {
  const { new_date, new_time, notes } = args as Record<string, string>;
  const appt = await findUpcomingAppointmentByPhone(ctx.phone);

  if (!appt) {
    return {
      result: "No upcoming appointment found. Want to book a new one?",
      ingest: { ...baseIngest(ctx), eventType: "voice_reschedule_no_appt" },
    };
  }

  const tz = process.env.CALENDAR_TIMEZONE || "America/Chicago";
  const ghlResult = appt.ghl_event_id
    ? await rescheduleGHLEvent(appt.ghl_event_id, new_date, new_time, tz)
    : { success: true, confirmed_time: `${new_date} at ${new_time}` };

  if (ghlResult.success) {
    await rescheduleAppointmentById(
      appt.id,
      new Date(`${new_date}T12:00:00`).toISOString(),
      ghlResult.confirmed_time || `${new_date} at ${new_time}`,
      appt.ghl_event_id
    );
    if (process.env.SEND_BOOKING_CONFIRMATION_SMS === "true") {
      const { sendTheoSms } = await import("@/lib/twilioSms");
      await sendTheoSms(
        ctx.phone,
        `✓ Rescheduled to ${ghlResult.confirmed_time}. Questions? Reply here.`
      ).catch(() => {});
    }
  }

  return {
    result: ghlResult.success
      ? `Done — rescheduled to ${ghlResult.confirmed_time}. Another confirmation coming now.`
      : "I had trouble updating that — I'll flag it for the agent.",
    ingest: {
      ...baseIngest(ctx),
      eventType: "voice_appointment_rescheduled",
      summary: `Rescheduled to ${ghlResult.confirmed_time || "?"}`,
    },
  };
}

// In syncToCrm case, add after CRM write:
if (args.outcome === "TRANSFERRED") {
  await notifySlackOnTransfer({
    outcome: "TRANSFERRED",
    caller_phone: ctx.phone,
    caller_name: ctx.lead?.full_name,
    notes: args.summary,
    tone: "neutral",
    call_id: ctx.callId,
    channel: "voice",
  }).catch(() => {});
}
```

### 3C — scripts/aria-provision.mjs (REPLACEMENT)

```javascript
#!/usr/bin/env node
// scripts/aria-provision.mjs
import { VapiClient } from "@vapi-ai/server-sdk";
import { buildAriaAssistant } from "../lib/ariaAssistant.js";
import { clientConfig } from "../lib/clientConfig.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const config = clientConfig();
  const opts = {
    publicUrl: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
    secret: process.env.CHANNEL_WEBHOOK_SECRET,
    respondModel: process.env.ARIA_MODEL,
    respondProvider: process.env.ARIA_MODEL_PROVIDER,
  };

  const payload = buildAriaAssistant(config, opts);

  if (DRY_RUN) {
    const preview = JSON.parse(JSON.stringify(payload));
    if (preview.model?.messages?.[0]) {
      preview.model.messages[0].content =
        preview.model.messages[0].content.slice(0, 400) + "... [truncated]";
    }
    console.log("=== DRY RUN ===");
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  if (!process.env.VAPI_API_KEY) {
    console.error("ERROR: VAPI_API_KEY not set");
    process.exit(1);
  }

  const vapi = new VapiClient({ token: process.env.VAPI_API_KEY });
  const existingId = process.env.ARIA_ASSISTANT_ID;

  const result = existingId
    ? await vapi.assistants.update(existingId, payload)
    : await vapi.assistants.create(payload);

  console.log(`✅ Aria synced: ${result.id}`);
  if (!existingId) console.log(`→ Set ARIA_ASSISTANT_ID=${result.id} in .env`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

---

## PART 4 — THEO (SMS/RCS/WhatsApp)

### 4A — lib/theoAppointments.ts (NEW)

Appointment management for Theo. Intercepts booking/cancel/reschedule intent
BEFORE the LLM runs — saves tokens, faster response.

```typescript
// lib/theoAppointments.ts
import { bookAppointment } from "@/lib/ariaCalendar";
import {
  findUpcomingAppointmentByPhone,
  cancelAppointmentById,
  rescheduleAppointmentById,
  formatAppointmentForAgent,
  createAppointment,
} from "@/lib/appointmentStore";
import { cancelGHLEvent, rescheduleGHLEvent } from "@/lib/ariaCalendar";
import { sendTheoSms } from "@/lib/twilioSms";
import { notifySlackOnBooking } from "@/lib/ariaSlack";

export type AppointmentIntent =
  | "book" | "reschedule" | "cancel" | "check" | "none";

export function detectAppointmentIntent(message: string): AppointmentIntent {
  const l = message.toLowerCase();
  if (/\b(reschedule|change|move|push back|different time|different day|can we do)\b/.test(l)) return "reschedule";
  if (/\b(cancel|cancellation|won't be able|can't make|not going to make|nevermind)\b/.test(l)) return "cancel";
  if (/\b(when is|what time|do i have|my appointment|my showing|confirm my|still on)\b/.test(l)) return "check";
  if (/\b(schedule|book|set up|arrange|tour|showing|want to see|visit|walk.?through|can i come|can we meet)\b/.test(l)) return "book";
  return "none";
}

export function extractTimeFromSms(
  message: string
): { date: string; time: string } | null {
  const lower = message.toLowerCase();
  const today = new Date();
  let targetDate: Date | null = null;

  if (/\btoday\b/.test(lower)) targetDate = today;
  else if (/\btomorrow\b/.test(lower)) {
    targetDate = new Date(today);
    targetDate.setDate(today.getDate() + 1);
  } else {
    const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
    const dayMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (dayMatch) {
      const targetDay = days.indexOf(dayMatch[1]);
      let daysAhead = targetDay - today.getDay();
      if (daysAhead <= 0) daysAhead += 7;
      targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysAhead);
    }
  }

  if (!targetDate) {
    const absMatch =
      lower.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/) ||
      lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/i);
    if (absMatch) {
      const months: Record<string, number> = {
        january:0,february:1,march:2,april:3,may:4,june:5,
        july:6,august:7,september:8,october:9,november:10,december:11,
      };
      const m = months[absMatch[1]?.toLowerCase()] ?? parseInt(absMatch[1]) - 1;
      const d = parseInt(absMatch[2]);
      targetDate = new Date(today.getFullYear(), m, d);
    }
  }

  if (!targetDate) return null;

  let time = "10:00 AM";
  const timeMatch = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    const h = timeMatch[1];
    const m = timeMatch[2] || "00";
    const ap = timeMatch[3].toUpperCase();
    time = `${h}:${m} ${ap}`;
  } else if (/\bmorning\b/.test(lower)) time = "10:00 AM";
  else if (/\bafternoon\b/.test(lower)) time = "2:00 PM";
  else if (/\bevening\b/.test(lower)) time = "5:00 PM";

  const dateStr = `${targetDate.getFullYear()}-${String(targetDate.getMonth()+1).padStart(2,"0")}-${String(targetDate.getDate()).padStart(2,"0")}`;
  return { date: dateStr, time };
}

export type TheoAppointmentResult = {
  handled: boolean;
  reply: string;
  nextAction?: string;
};

export async function handleTheoAppointmentMessage(
  phone: string,
  message: string,
  lead: Partial<{ full_name: string; email: string; property_interest: string }> | null
): Promise<TheoAppointmentResult> {
  const intent = detectAppointmentIntent(message);
  if (intent === "none") return { handled: false, reply: "" };

  const firstName = (lead?.full_name || "").split(" ")[0] || "";

  if (intent === "check") {
    const appt = await findUpcomingAppointmentByPhone(phone);
    if (!appt) return {
      handled: true,
      reply: `${firstName ? firstName + ", you don't" : "You don't"} have any upcoming appointments on file. Want to schedule one?`,
      nextAction: "await_confirmation",
    };
    return {
      handled: true,
      reply: `${firstName ? firstName + ", your" : "Your"} ${formatAppointmentForAgent(appt)}. Reply "reschedule" or "cancel" if needed.`,
      nextAction: "done",
    };
  }

  if (intent === "cancel") {
    const appt = await findUpcomingAppointmentByPhone(phone);
    if (!appt) return {
      handled: true,
      reply: "No upcoming appointment found to cancel. Want to book a new one?",
      nextAction: "done",
    };
    await cancelAppointmentById(appt.id);
    if (appt.ghl_event_id) await cancelGHLEvent(appt.ghl_event_id).catch(() => {});
    return {
      handled: true,
      reply: `Got it${firstName ? ", " + firstName : ""} — your appointment has been cancelled. Let me know when you'd like to reschedule.`,
      nextAction: "done",
    };
  }

  if (intent === "reschedule") {
    const appt = await findUpcomingAppointmentByPhone(phone);
    if (!appt) return {
      handled: true,
      reply: "No upcoming appointment found. Want to book a new one?",
      nextAction: "await_confirmation",
    };
    const timePref = extractTimeFromSms(message);
    if (!timePref) return {
      handled: true,
      reply: `Sure${firstName ? ", " + firstName : ""} — what day and time works for you?`,
      nextAction: "needs_time",
    };
    const calResult = await bookAppointment({
      date: timePref.date, time: timePref.time,
      caller_phone: phone,
      caller_name: lead?.full_name || "",
      caller_email: "",
      property_address: appt.property_address,
      appointment_type: appt.appointment_type,
      notes: `Rescheduled via SMS from ${appt.scheduled_at_local}`,
      booked_via_channel: "sms",
    });
    if (calResult.success) {
      await rescheduleAppointmentById(
        appt.id,
        new Date(`${timePref.date}T12:00:00`).toISOString(),
        calResult.confirmed_time || timePref.time,
        calResult.appointment_id
      );
      return {
        handled: true,
        reply: `Done${firstName ? ", " + firstName : ""} — rescheduled to ${calResult.confirmed_time}. Confirmation on the way.`,
        nextAction: "done",
      };
    }
    return {
      handled: true,
      reply: "I had trouble updating that — I'll flag it for the agent to sort out.",
      nextAction: "done",
    };
  }

  if (intent === "book") {
    const timePref = extractTimeFromSms(message);
    if (!timePref) return {
      handled: true,
      reply: `${firstName ? firstName + ", what" : "What"} day and time works? Morning or afternoon is fine.`,
      nextAction: "needs_time",
    };
    const propertyAddress = lead?.property_interest || "";
    const calResult = await bookAppointment({
      date: timePref.date, time: timePref.time,
      caller_phone: phone,
      caller_name: lead?.full_name || "",
      caller_email: "",
      property_address: propertyAddress,
      appointment_type: "showing",
      notes: "Booked via SMS",
      booked_via_channel: "sms",
    });
    if (calResult.success) {
      await notifySlackOnBooking({
        outcome: "BOOKED",
        caller_name: lead?.full_name,
        caller_phone: phone,
        appointment_time: calResult.confirmed_time,
        property_address: propertyAddress,
        channel: "sms",
      }).catch(() => {});
      return {
        handled: true,
        reply: `${firstName ? firstName + ", you're" : "You're"} set for ${calResult.confirmed_time}${propertyAddress ? " at " + propertyAddress : ""}. Confirmation on the way.`,
        nextAction: "done",
      };
    }
    return {
      handled: true,
      reply: "Sounds good — I'll have the agent confirm that time with you.",
      nextAction: "done",
    };
  }

  return { handled: false, reply: "" };
}
```

### 4B — lib/theoAgent.ts (EDIT — add appointment intercept + cross-channel context)

At the very top of `generateTheoReply()`, before classification:

```typescript
// ADD to imports:
import { handleTheoAppointmentMessage } from "@/lib/theoAppointments";

// ADD at top of generateTheoReply(), before classification:
if (context.lead?.phone) {
  const apptResult = await handleTheoAppointmentMessage(
    context.lead.phone,
    context.message,
    context.lead || null
  );
  if (apptResult.handled) {
    return {
      classification: {
        intent: "showing_request",
        leadRole: context.lead?.lead_role || "buyer",
        handoffReason: "",
        status: apptResult.nextAction === "done" ? "replied" : "awaiting_response",
      },
      reply: apptResult.reply,
      mediaUrls: [],
      shouldSend: true,
      aiAction: "appointment_handled",
      handoffReason: "",
      status: apptResult.nextAction === "done" ? "replied" : "awaiting_response",
      metrics: [],
    };
  }
}
```

### 4C — lib/theoLlm.ts (EDIT — add cross-channel + appointment context to prompt)

Add to Theo's system prompt string (append before styleBlock):

```typescript
// ADD to Theo's system string, before styleBlock():
- Cross-channel context: you share memory with Aria (voice), Iris (email), and Olivia (web). If the lead has talked to another channel, reference it briefly: "I see you were looking at Round Rock by email — still the area?" Use this to skip re-asking things already known.
- Appointments: if lead memory shows an upcoming appointment, reference it naturally when relevant: "You've got a showing Thursday — still good?" Do not re-book if one already exists unless they ask to reschedule.
- Hot lead detection: if timeline is 0-3 months AND budget is set AND area is set → add "hot_lead" to opportunityTags and call sendTheoHandoffAlert.
- Preferred channel: if lead states email/call/text preference, acknowledge briefly and note it in qualifyLead fields.
```

Also add upcoming appointment context to the user message:

```typescript
// ADD in generateTheoSmsWithLlm(), after building existing context:
import { findUpcomingAppointmentByPhone, formatAppointmentForAgent } from "@/lib/appointmentStore";

const phone = context.lead?.phone || "";
const upcomingAppt = phone
  ? await findUpcomingAppointmentByPhone(phone).catch(() => null)
  : null;
const apptContext = upcomingAppt
  ? `\nUpcoming appointment: ${formatAppointmentForAgent(upcomingAppt)}`
  : "";

// Append apptContext to user message string
```

### 4D — lib/ariaSmsControl.ts (NEW)

Lets the human agent SMS-control Aria's outbound dialing:

```typescript
// lib/ariaSmsControl.ts
// Agent can text ARIA_SMS_CONTROL_NUMBER to control outbound:
// Commands: status | pause | resume | call +1xxxxxxxxxx | help
import { sendTheoSms } from "@/lib/twilioSms";

export async function handleAgentSmsControl(from: string, body: string): Promise<void> {
  const agentPhone = process.env.AGENT_PHONE || "";
  if (!agentPhone || from !== agentPhone) return;

  const cmd = body.trim().toLowerCase();

  if (cmd === "help") {
    await sendTheoSms(from, "Aria commands:\n• status\n• pause\n• resume\n• call +1xxxxxxxxxx\n• help");
    return;
  }
  if (cmd === "status") {
    await sendTheoSms(from, `Aria outbound: ${process.env.ARIA_OUTBOUND_PAUSED === "true" ? "PAUSED" : "ACTIVE"}`);
    return;
  }
  if (cmd === "pause") {
    process.env.ARIA_OUTBOUND_PAUSED = "true";
    await sendTheoSms(from, "Aria outbound paused for 30 min.");
    setTimeout(() => { process.env.ARIA_OUTBOUND_PAUSED = "false"; }, 30 * 60 * 1000);
    return;
  }
  if (cmd === "resume") {
    process.env.ARIA_OUTBOUND_PAUSED = "false";
    await sendTheoSms(from, "Aria outbound resumed.");
    return;
  }
  if (cmd.startsWith("call ")) {
    const number = cmd.replace("call ", "").trim();
    if (!/^\+1\d{10}$/.test(number)) {
      await sendTheoSms(from, "Invalid number. Use E.164: +1xxxxxxxxxx");
      return;
    }
    const vapiKey = process.env.VAPI_API_KEY;
    const assistantId = process.env.ARIA_ASSISTANT_ID;
    const phoneNumberId = process.env.ARIA_PHONE_NUMBER_ID;
    if (!vapiKey || !assistantId || !phoneNumberId) {
      await sendTheoSms(from, "Aria not fully configured.");
      return;
    }
    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${vapiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ assistantId, phoneNumberId, customer: { number } }),
    });
    await sendTheoSms(from, res.ok ? `✓ Aria calling ${number} now.` : `Failed: ${res.status}`);
    return;
  }
  await sendTheoSms(from, "Unknown command. Text 'help' for options.");
}
```

---

## PART 5 — IRIS (email agent)

### 5A — Iris keeps Calendly for showing booking (confirmed decision)

Email pace means Calendly is the right UX. Iris sends personalized Calendly links,
not direct GHL booking. The personalization wrapper makes it warmer:

```python
# In agent.py, when intent == "showing_request", replace bare link with:
def build_showing_cta(lead_name: str, property_address: str, calendly_url: str) -> str:
    name_part = f"Hi {lead_name.split()[0]}," if lead_name else "Hi,"
    prop_part = f" for {property_address}" if property_address else ""
    return (
        f"{name_part} I'd love to set up a showing{prop_part}. "
        f"You can grab a time that works for you here: {calendly_url}\n\n"
        f"Once you book, you'll get a confirmation with all the details."
    )
```

### 5B — app/api/webhooks/iris-book-appointment/route.ts (NEW)

Internal endpoint so Iris (Python) can write appointments to shared Neon store
when a lead books via Calendly webhook or direct booking:

```typescript
// app/api/webhooks/iris-book-appointment/route.ts
import { NextRequest, NextResponse } from "next/server";
import { assertWebhookSecret } from "@/lib/webhookRequest";
import { createAppointment } from "@/lib/appointmentStore";
import { notifySlackOnBooking } from "@/lib/ariaSlack";
import { sendTheoSms } from "@/lib/twilioSms";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    assertWebhookSecret(req);
    const body = await req.json() as Record<string, string>;
    const {
      caller_phone, caller_name, caller_email,
      property_address, scheduled_at, scheduled_at_local,
      appointment_type = "showing", notes,
    } = body;

    if (!caller_phone || !scheduled_at) {
      return NextResponse.json({ success: false, error: "Missing phone or scheduled_at" }, { status: 400 });
    }

    const record = await createAppointment({
      caller_phone, caller_name, caller_email,
      appointment_type: appointment_type as "showing" | "consultation",
      property_address, scheduled_at, scheduled_at_local,
      booked_via_channel: "email",
      notes,
    });

    await notifySlackOnBooking({
      outcome: "BOOKED",
      caller_name, caller_phone,
      appointment_time: scheduled_at_local || scheduled_at,
      property_address,
      channel: "email",
    }).catch(() => {});

    if (process.env.SEND_BOOKING_CONFIRMATION_SMS === "true" && caller_phone) {
      const msg = [
        `✓ Showing confirmed.`,
        `📅 ${scheduled_at_local || scheduled_at}`,
        property_address ? `🏠 ${property_address}` : "",
        `Questions? Reply to this text.`,
      ].filter(Boolean).join("\n");
      await sendTheoSms(caller_phone, msg).catch(() => {});
    }

    return NextResponse.json({ success: true, appointment_id: record.id });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
```

---

## PART 6 — OLIVIA (website chat)

### 6A — app/api/webhooks/olivia-website/route.ts (EDIT)

Add immediate booking when web form includes a date preference:

```typescript
// ADD to imports:
import { bookAppointment } from "@/lib/ariaCalendar";
import { notifySlackOnHotLead } from "@/lib/ariaSlack";

// ADD in POST handler, after recording lead, before sending Theo SMS:
const showingDatePref = stringValue(payload, "preferred_date", "showing_date", "appointment_date");
const propertyForShowing = propertyInterest || stringValue(payload, "address");

if (phone && hasSmsConsent && showingDatePref && propertyForShowing) {
  const lower = showingDatePref.toLowerCase();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,"0")}-${String(tomorrow.getDate()).padStart(2,"0")}`;
  const time = /afternoon/.test(lower) ? "2:00 PM" : "10:00 AM";

  const bookResult = await bookAppointment({
    date: dateStr, time,
    caller_phone: phone,
    caller_name: fullName,
    caller_email: email,
    property_address: propertyForShowing,
    appointment_type: "showing",
    notes: `Booked via website form. Preference: ${showingDatePref}`,
    booked_via_channel: "web",
  }).catch(() => null);

  if (bookResult?.success && reply.shouldSend) {
    reply.reply = `You're set for ${bookResult.confirmed_time} at ${propertyForShowing}. ${reply.reply}`;
  }
}

// ADD hot lead detection:
const leadRole = result.lead?.lead_role || "";
const budget = result.lead?.budget || "";
const area = result.lead?.area || "";
const timeline = result.lead?.timeline || "";
if (phone && leadRole && budget && area && /\b([0-3]|asap|immediately)\b/.test(timeline.toLowerCase())) {
  await notifySlackOnHotLead({
    outcome: "HOT_LEAD",
    caller_phone: phone,
    caller_name: fullName,
    timeline,
    property_address: propertyForShowing,
    notes: `Web form submission. Budget: ${budget}, Area: ${area}`,
    channel: "web",
  }).catch(() => {});
}
```

---

## PART 7 — WEBHOOK ROUTES

### 7A — app/api/webhooks/aria-sms-control/route.ts (NEW)

```typescript
// app/api/webhooks/aria-sms-control/route.ts
import { NextRequest, NextResponse } from "next/server";
import { handleAgentSmsControl } from "@/lib/ariaSmsControl";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.formData();
  const from = String(body.get("From") || "");
  const msgBody = String(body.get("Body") || "");
  await handleAgentSmsControl(from, msgBody);
  return new NextResponse("<Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}
```

Point Twilio SMS webhook for `ARIA_SMS_CONTROL_NUMBER` at:
`${PUBLIC_BASE_URL}/api/webhooks/aria-sms-control`

---

## PART 8 — ENV VARS (full .env.example additions)

```bash
# ── Aria / VAPI ───────────────────────────────────────────────────────────────
VAPI_API_KEY=
ARIA_VOICE_ID=Paige
ARIA_MODEL=claude-sonnet-4-6
ARIA_MODEL_PROVIDER=anthropic
ARIA_ENRICHMENT_TIMEOUT_MS=3500
ARIA_PHONE_NUMBER_ID=
ARIA_ASSISTANT_ID=
HUMAN_TRANSFER_NUMBER=+1xxxxxxxxxx
ARIA_OUTBOUND_PAUSED=false

# ── Calendar ──────────────────────────────────────────────────────────────────
CALENDAR_PROVIDER=ghl
GHL_CALENDAR_ID=
GOOGLE_CALENDAR_ID=
CALENDAR_TIMEZONE=America/Chicago
SEND_BOOKING_CONFIRMATION_SMS=true
SEND_BOOKING_REMINDER_SMS=true
BOOKING_REMINDER_LEAD_MINUTES=120
VERIFY_INBOUND_CALLER=true

# ── Slack ─────────────────────────────────────────────────────────────────────
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=
SLACK_HOTLEAD_CHANNEL=#hot-leads
SLACK_HANDOFF_CHANNEL=#agent-handoffs
SLACK_DAILY_DIGEST_CHANNEL=#aria-daily

# ── GHL additions ─────────────────────────────────────────────────────────────
GHL_CONTACT_TAG_VOICE=aria-voice

# ── Agent SMS control ─────────────────────────────────────────────────────────
ARIA_SMS_CONTROL_NUMBER=+1xxxxxxxxxx
ENABLE_ARIA_SMS_CONTROL=true

# ── Cross-channel booking ─────────────────────────────────────────────────────
ENABLE_CROSS_CHANNEL_BOOKING=true
```

---

## PART 9 — PACKAGE.JSON SCRIPTS

Add to package.json:

```json
{
  "scripts": {
    "aria:provision": "npx tsx scripts/aria-provision.mjs",
    "aria:provision:dry": "npx tsx scripts/aria-provision.mjs --dry-run",
    "aria:test": "npx tsx scripts/aria-test.mjs",
    "theo:test": "npx tsx scripts/theo-test.mjs"
  }
}
```

---

## PART 10 — DEPLOY SEQUENCE

```bash
# 1. Install deps
npm install @vapi-ai/server-sdk
npm install -g @vapi-ai/cli
vapi login
claude mcp add vapi-docs -- npx -y mcp-remote https://docs.vapi.ai/_mcp/server

# 2. Run DB migrations in order
psql "$DATABASE_URL" -f db/migrations/004_aria_appointments.sql
psql "$DATABASE_URL" -f db/migrations/005_lead_memory_improvements.sql
npm run sync:sheets

# 3. Provision VAPI phone number (once)
vapi phone-numbers create --provider vapi --area-code 512
# Copy id → ARIA_PHONE_NUMBER_ID in .env

# 4. Dry run Aria
npm run aria:provision:dry

# 5. Deploy Aria to VAPI
npm run aria:provision
# Copy returned id → ARIA_ASSISTANT_ID in .env

# 6. Re-provision with correct ID
npm run aria:provision

# 7. Wire phone number to assistant
vapi phone-numbers update $ARIA_PHONE_NUMBER_ID --assistant-id $ARIA_ASSISTANT_ID

# 8. Configure Twilio webhooks
# SMS control: POST ${PUBLIC_BASE_URL}/api/webhooks/aria-sms-control
# Theo SMS: POST ${PUBLIC_BASE_URL}/api/webhooks/theo-sms (already configured)
npm run theo:twilio:configure

# 9. Configure Slack app
# Create Slack app at api.slack.com
# Add bot token scopes: chat:write, channels:read
# Install to workspace → copy SLACK_BOT_TOKEN
# Create channels: #hot-leads, #agent-handoffs

# 10. Test each channel
npm run aria:test           # voice: test inbound call
npm run theo:test -- "Can I see 123 Main St Thursday afternoon" "+15125551234"
# Email: send test inquiry to configured Gmail
# Web: POST to /api/webhooks/olivia-website with test payload

# 11. Smoke test cross-channel memory
# 1. Send Theo SMS as "Sarah" with budget $450k, Round Rock
# 2. Call Aria from same number
# 3. Verify Aria opens with "Returning buyer: Sarah — has interacted via sms"
# 4. Verify Aria doesn't re-ask budget or area
```

---

## PART 11 — FILES SUMMARY


| File                                              | Action                           | Used by                  |
| ------------------------------------------------- | -------------------------------- | ------------------------ |
| `db/migrations/004_aria_appointments.sql`         | CREATE                           | All channels             |
| `db/migrations/005_lead_memory_improvements.sql`  | CREATE                           | All channels             |
| `lib/appointmentStore.ts`                         | CREATE                           | Aria, Theo, Iris, Olivia |
| `lib/ariaCalendar.ts`                             | CREATE                           | Aria, Theo, Olivia       |
| `lib/ariaMemory.ts`                               | CREATE                           | Aria (getCallerContext)  |
| `lib/ariaSlack.ts`                                | CREATE                           | Aria, Theo, Olivia       |
| `lib/ariaAssistant.ts`                            | REPLACE                          | Aria/VAPI                |
| `lib/ariaTools.ts`                                | EDIT — add 4 tool cases          | Aria                     |
| `lib/theoAppointments.ts`                         | CREATE                           | Theo                     |
| `lib/theoAgent.ts`                                | EDIT — add appointment intercept | Theo                     |
| `lib/theoLlm.ts`                                  | EDIT — add cross-channel context | Theo                     |
| `lib/ariaSmsControl.ts`                           | CREATE                           | Agent control            |
| `lib/sheetSchema.ts`                              | EDIT — add new fields            | All                      |
| `agent.py`                                        | EDIT — add booking CTA helper    | Iris                     |
| `app/api/webhooks/iris-book-appointment/route.ts` | CREATE                           | Iris → Neon              |
| `app/api/webhooks/olivia-website/route.ts`        | EDIT — add booking + hot lead    | Olivia                   |
| `app/api/webhooks/aria-sms-control/route.ts`      | CREATE                           | Agent control            |
| `scripts/aria-provision.mjs`                      | REPLACE                          | VAPI deploy              |


---

## WHAT THIS BUILDS VS EVERY COMPETITOR


| Feature                                | Structurely | Lofty AOS                   | Roof AI        | Ylopo           | **Lumenosis**             |
| -------------------------------------- | ----------- | --------------------------- | -------------- | --------------- | ------------------------- |
| Inbound email → listing facts reply    | ✗           | Partial (inside Lofty only) | ✗ (chat only)  | ✗               | ✓                         |
| Cross-channel shared memory            | ✗           | CRM fields only             | ✗              | ✗               | ✓ Full event history      |
| Voice reads SMS/email transcripts      | ✗           | ✗                           | ✗              | ✗               | ✓                         |
| Book/cancel/reschedule via SMS         | ✗           | ✗                           | ✗              | ✗               | ✓                         |
| Appointment sync across all channels   | ✗           | ✗                           | ✗              | ✗               | ✓ Neon appointments table |
| Google Sheets + Zillow listing source  | —           | Lofty CRM only              | MLS only       | IDX only        | ✓ Any source              |
| Stack-agnostic (works without big CRM) | ✗           | ✗ (needs Lofty)             | ✗ (needs Roof) | ✗ (needs Ylopo) | ✓                         |
| Agent SMS control of outbound          | ✗           | ✗                           | ✗              | ✗               | ✓                         |
| Slack notifications on bookings        | ✗           | ✗                           | ✗              | ✗               | ✓                         |
| WhatsApp native                        | ✗           | ✗                           | ✗              | ✗               | ✓ (via Theo/Twilio)       |


**The one-line pitch:**
*"Lofty has listing-data email if you're fully inside their CRM. Iris works from
your Google Sheet and Zillow regardless of your stack — and every channel
shares one memory so leads never repeat themselves."*

---

## ADDENDUM A — FULL CALENDAR PROVIDER SUPPORT

### What real estate pros actually use (in priority order)

1. **GHL Calendar** — anyone on GoHighLevel (already in stack)
2. **Google Calendar** — Google Workspace agents (most common)
3. **Calendly** — send booking link only (for Iris email, Olivia web — confirmed decision)
4. **Microsoft Outlook / Bookings** — brokerage-run Microsoft 365 shops
5. **ShowingTime** — MLS-integrated showing coordination (separate from consultation scheduling)
6. **Acuity Scheduling** — teams with pre-qualification intake forms

Architecture decision: GHL and Google Calendar get direct write API. Calendly,
Outlook/Bookings, Acuity, ShowingTime get booking LINK generation only — the link
approach is more reliable than fighting their APIs and respects availability checking.

### Update lib/ariaCalendar.ts — expand provider support

Replace the single `bookGHL` function with a full provider abstraction:

```typescript
// lib/ariaCalendar.ts — UPDATED with full provider support

export type CalendarProvider =
  | "ghl"           // GoHighLevel (direct API write)
  | "google"        // Google Calendar (direct API write)
  | "calendly"      // Send booking link via SMS/email
  | "outlook"       // Microsoft Bookings link
  | "acuity"        // Acuity Scheduling link
  | "showingtime"   // ShowingTime link (MLS showings)
  | "link";         // Generic custom booking URL

// Add to AppointmentResult:
export type AppointmentResult = {
  success: boolean;
  appointment_id?: string;
  neon_id?: string;
  confirmed_time?: string;
  calendar_url?: string;
  booking_link?: string;        // NEW: for link-based providers
  provider_used?: string;       // NEW: which provider handled it
  requires_confirmation?: boolean; // NEW: true for link-based (lead must click)
  error?: string;
};

// ── Provider router ───────────────────────────────────────────────────────────

export async function bookAppointment(
  input: AppointmentInput
): Promise<AppointmentResult> {
  const provider = (process.env.CALENDAR_PROVIDER || "ghl") as CalendarProvider;

  let result: AppointmentResult;

  switch (provider) {
    case "ghl":
      result = await bookGHL(input);
      break;
    case "google":
      result = await bookGoogle(input);
      break;
    case "calendly":
      result = buildCalendlyLink(input);
      break;
    case "outlook":
      result = buildOutlookBookingsLink(input);
      break;
    case "acuity":
      result = buildAcuityLink(input);
      break;
    case "showingtime":
      result = buildShowingTimeLink(input);
      break;
    case "link":
    default:
      result = buildGenericLink(input);
  }

  if (result.success) {
    // Always write to Neon regardless of provider
    const tz = input.timezone || process.env.CALENDAR_TIMEZONE || "America/Chicago";
    const neonRecord = await createAppointment({
      caller_phone: input.caller_phone,
      caller_name: input.caller_name,
      caller_email: input.caller_email,
      appointment_type: input.appointment_type,
      property_address: input.property_address,
      scheduled_at: result.requires_confirmation
        ? new Date().toISOString()  // placeholder until confirmed
        : parseLocalDateTime(input.date, input.time, tz),
      scheduled_at_local: result.confirmed_time || `${input.date} at ${input.time}`,
      duration_minutes: input.duration_minutes || 30,
      ghl_event_id: result.appointment_id || "",
      booked_via_channel: input.booked_via_channel || "unknown",
      call_id: input.call_id,
      notes: [
        input.notes,
        result.booking_link ? `Booking link: ${result.booking_link}` : "",
        result.requires_confirmation ? "Status: pending lead confirmation" : "",
      ].filter(Boolean).join("\n"),
    }).catch(() => null);

    if (neonRecord) result.neon_id = neonRecord.id;

    // Confirmation SMS
    if (process.env.SEND_BOOKING_CONFIRMATION_SMS === "true" && input.caller_phone) {
      const msg = buildConfirmationSms(input, result);
      const { sendTheoSms } = await import("@/lib/twilioSms");
      await sendTheoSms(input.caller_phone, msg).catch(() => {});
    }
  }

  return { ...result, provider_used: provider };
}

// ── Google Calendar direct write ──────────────────────────────────────────────

async function bookGoogle(input: AppointmentInput): Promise<AppointmentResult> {
  const credPath = process.env.GOOGLE_CALENDAR_CREDENTIALS_PATH;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!credPath || !calendarId) {
    return { success: false, error: "GOOGLE_CALENDAR_ID or credentials not set" };
  }

  try {
    // Use googleapis — npm install googleapis
    const { google } = await import("googleapis");
    const auth = new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    const calendar = google.calendar({ version: "v3", auth });

    const tz = input.timezone || process.env.CALENDAR_TIMEZONE || "America/Chicago";
    const startDateTime = parseLocalDateTime(input.date, input.time, tz);
    const endDateTime = addMinutes(startDateTime, input.duration_minutes ?? 30);

    const event = {
      summary: `${input.appointment_type === "showing" ? "Showing" : "Appt"} — ${input.caller_name}`,
      description: [
        input.property_address ? `Property: ${input.property_address}` : "",
        `Phone: ${input.caller_phone}`,
        input.caller_email ? `Email: ${input.caller_email}` : "",
        input.notes || "",
        `Booked via: ${input.booked_via_channel || "unknown"}`,
      ].filter(Boolean).join("\n"),
      start: { dateTime: startDateTime, timeZone: tz },
      end: { dateTime: endDateTime, timeZone: tz },
      attendees: input.caller_email ? [{ email: input.caller_email }] : [],
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 60 * 24 },  // 24h email
          { method: "popup", minutes: 30 },
        ],
      },
    };

    const res = await calendar.events.insert({
      calendarId,
      sendUpdates: "all",
      requestBody: event,
    });

    return {
      success: true,
      appointment_id: res.data.id || undefined,
      confirmed_time: `${input.date} at ${input.time}`,
      calendar_url: res.data.htmlLink || undefined,
    };
  } catch (e) {
    return { success: false, error: `Google Calendar: ${String(e)}` };
  }
}

// ── Link-based providers (no direct write — send booking link) ────────────────

function buildCalendlyLink(input: AppointmentInput): AppointmentResult {
  const baseUrl = process.env.CALENDLY_URL;
  if (!baseUrl) return { success: false, error: "CALENDLY_URL not set" };

  // Calendly prefill params
  const params = new URLSearchParams({
    name: input.caller_name || "",
    email: input.caller_email || "",
    a1: input.property_address || "",  // custom question 1
  });

  const link = `${baseUrl}?${params.toString()}`;
  return {
    success: true,
    booking_link: link,
    confirmed_time: `TBD — lead selects time via link`,
    requires_confirmation: true,
  };
}

function buildOutlookBookingsLink(input: AppointmentInput): AppointmentResult {
  const baseUrl = process.env.OUTLOOK_BOOKINGS_URL;
  if (!baseUrl) return { success: false, error: "OUTLOOK_BOOKINGS_URL not set" };
  return {
    success: true,
    booking_link: baseUrl,
    confirmed_time: "TBD — lead selects time via link",
    requires_confirmation: true,
  };
}

function buildAcuityLink(input: AppointmentInput): AppointmentResult {
  const baseUrl = process.env.ACUITY_URL;
  if (!baseUrl) return { success: false, error: "ACUITY_URL not set" };
  const params = new URLSearchParams({
    firstName: (input.caller_name || "").split(" ")[0],
    lastName: (input.caller_name || "").split(" ").slice(1).join(" "),
    email: input.caller_email || "",
    phone: input.caller_phone || "",
  });
  return {
    success: true,
    booking_link: `${baseUrl}?${params.toString()}`,
    confirmed_time: "TBD — lead selects time via link",
    requires_confirmation: true,
  };
}

function buildShowingTimeLink(input: AppointmentInput): AppointmentResult {
  const baseUrl = process.env.SHOWINGTIME_URL;
  if (!baseUrl) return { success: false, error: "SHOWINGTIME_URL not set" };
  return {
    success: true,
    booking_link: baseUrl,
    confirmed_time: "TBD — showing request submitted",
    requires_confirmation: true,
  };
}

function buildGenericLink(input: AppointmentInput): AppointmentResult {
  const url = process.env.BOOKING_LINK_URL || process.env.CALENDLY_URL || "";
  if (!url) return { success: false, error: "No booking link URL configured" };
  return {
    success: true,
    booking_link: url,
    confirmed_time: "TBD — lead selects time via link",
    requires_confirmation: true,
  };
}

// ── SMS builder aware of provider type ───────────────────────────────────────

function buildConfirmationSms(
  input: AppointmentInput,
  result: AppointmentResult
): string {
  if (result.requires_confirmation && result.booking_link) {
    // Link-based: send the link
    return [
      `Hi ${(input.caller_name || "").split(" ")[0] || "there"}!`,
      input.property_address
        ? `Here's a link to book your ${input.appointment_type} at ${input.property_address}:`
        : `Here's a link to book your ${input.appointment_type}:`,
      result.booking_link,
      `Reply with any questions.`,
    ].filter(Boolean).join("\n");
  }

  // Direct booking confirmed
  return [
    `✓ ${input.appointment_type === "showing" ? "Showing" : "Appointment"} confirmed.`,
    `📅 ${result.confirmed_time}`,
    input.property_address ? `🏠 ${input.property_address}` : "",
    result.calendar_url ? `📆 ${result.calendar_url}` : "",
    `Reply with any questions.`,
  ].filter(Boolean).join("\n");
}
```

### New env vars for calendar providers

```bash
# ── Calendar providers ────────────────────────────────────────────────────────
CALENDAR_PROVIDER=ghl         # ghl | google | calendly | outlook | acuity | showingtime | link

# GHL (already in .env)
# GHL_CALENDAR_ID=
# GHL_PRIVATE_INTEGRATION_TOKEN=

# Google Calendar
GOOGLE_CALENDAR_ID=           # e.g. primary or specific@group.calendar.google.com
GOOGLE_CALENDAR_CREDENTIALS_PATH=google_calendar_credentials.json
  # Service account JSON with calendar write scope
  # OR: GOOGLE_CALENDAR_REFRESH_TOKEN= (OAuth2 token)

# Calendly (link-based)
CALENDLY_URL=https://calendly.com/youragent/30min

# Microsoft Outlook Bookings (link-based)
OUTLOOK_BOOKINGS_URL=https://outlook.office365.com/owa/calendar/...

# Acuity (link-based)
ACUITY_URL=https://app.acuityscheduling.com/schedule.php?owner=...

# ShowingTime (link-based — for MLS showing requests)
SHOWINGTIME_URL=https://app.showingtime.com/...

# Generic fallback
BOOKING_LINK_URL=             # Any booking URL if none of above set
```

### How agents pick their provider

In `lib/clientConfig.ts`, update `resolveClientConfig()`:

```typescript
calendarProvider: str(env, "CALENDAR_PROVIDER", "ghl"),
// Then in ariaCalendar.ts, process.env.CALENDAR_PROVIDER drives the router
```

---

## ADDENDUM B — LEAD SCORING (all channels)

### lib/leadScoring.ts (NEW)

Numeric lead score 0–100 computed from qualification signals.
Written to `lead_memory.lead_score` on every channel interaction.
All agents use it to prioritize, escalate, and tailor responses.

```typescript
// lib/leadScoring.ts
// Lead score 0-100 across all channels.
// Written to Neon lead_memory.lead_score on every qualifying interaction.
// Score drives: Slack hot-lead alerts, agent handoff urgency, nurture cadence.

import type { SheetRow } from "@/lib/sheetSchema";

export type LeadScoreInput = {
  lead: Partial<SheetRow>;
  recentEvents?: SheetRow[];
  appointmentCount?: number;
  lastTouchChannel?: string;
};

export type LeadScoreResult = {
  score: number;          // 0-100
  tier: "hot" | "warm" | "cool" | "cold";
  signals: string[];      // human-readable reasons
  missing: string[];      // qualification fields still unknown
};

// ── Scoring weights ───────────────────────────────────────────────────────────

const WEIGHTS = {
  // Timeline (most predictive)
  timeline_immediate: 25,    // ASAP / 0-30 days
  timeline_short: 18,        // 1-3 months
  timeline_medium: 10,       // 3-6 months
  timeline_long: 3,          // 6+ months

  // Financial readiness
  pre_approved: 20,
  budget_set: 10,
  budget_specific: 5,        // bonus for specific number vs range

  // Intent signals
  specific_property_interest: 10,  // asked about a named address
  role_buyer_or_seller: 5,
  area_specified: 5,
  beds_specified: 3,
  sell_before_buy_no: 5,     // doesn't need to sell first = cleaner deal

  // Engagement
  multiple_channels: 8,      // contacted via 2+ channels
  recent_touch_24h: 5,
  appointment_booked: 15,
  appointment_kept: 10,      // completed appointment
  email_replied: 3,
  sms_replied: 3,

  // Consent
  call_consent: 5,
  sms_consent: 3,
};

// ── Timeline parser ───────────────────────────────────────────────────────────

function parseTimlineScore(timeline: string): {
  weight: number;
  label: string;
} {
  const l = (timeline || "").toLowerCase();
  if (/asap|immediately|now|urgent|right away|this week/.test(l)) {
    return { weight: WEIGHTS.timeline_immediate, label: "immediate timeline" };
  }
  if (/\b([1-3])\s*month|\b(one|two|three)\s*month|next month|soon/.test(l)) {
    return { weight: WEIGHTS.timeline_short, label: "1-3 month timeline" };
  }
  if (/\b([4-6])\s*month|\b(four|five|six)\s*month|this (?:summer|spring|fall|winter|quarter|year)/.test(l)) {
    return { weight: WEIGHTS.timeline_medium, label: "3-6 month timeline" };
  }
  if (/\b([7-9]|1[0-2]|\d{2,})\s*month|next year|eventually|long.?term/.test(l)) {
    return { weight: WEIGHTS.timeline_long, label: "6+ month timeline" };
  }
  return { weight: 0, label: "" };
}

// ── Main scorer ───────────────────────────────────────────────────────────────

export function computeLeadScore(input: LeadScoreInput): LeadScoreResult {
  const { lead, recentEvents = [], appointmentCount = 0, lastTouchChannel } = input;
  let score = 0;
  const signals: string[] = [];
  const missing: string[] = [];

  // Timeline
  if (lead.timeline) {
    const { weight, label } = parseTimlineScore(lead.timeline);
    if (weight > 0) { score += weight; signals.push(label); }
    else signals.push("timeline vague");
  } else {
    missing.push("timeline");
  }

  // Budget
  if (lead.budget) {
    score += WEIGHTS.budget_set;
    signals.push(`budget set (${lead.budget})`);
    // Bonus for specific number
    if (/\$[\d,]+/.test(lead.budget)) {
      score += WEIGHTS.budget_specific;
      signals.push("specific budget amount");
    }
  } else {
    missing.push("budget");
  }

  // Pre-approval check (from event text)
  const allText = recentEvents.map(e => `${e.message_text} ${e.summary}`).join(" ").toLowerCase();
  if (/pre.?approv|prequalif|approved|lender/.test(allText)) {
    score += WEIGHTS.pre_approved;
    signals.push("pre-approval mentioned");
  }

  // Property interest
  if (lead.property_interest) {
    score += WEIGHTS.specific_property_interest;
    signals.push(`interested in ${lead.property_interest}`);
  }

  // Area
  if (lead.area) {
    score += WEIGHTS.area_specified;
    signals.push(`area: ${lead.area}`);
  } else {
    missing.push("area");
  }

  // Bedrooms
  if (lead.bedrooms) {
    score += WEIGHTS.beds_specified;
    signals.push(`${lead.bedrooms} bed preference`);
  }

  // Role
  if (lead.lead_role === "buyer" || lead.lead_role === "seller") {
    score += WEIGHTS.role_buyer_or_seller;
    signals.push(lead.lead_role);
  } else if (!lead.lead_role) {
    missing.push("buyer/seller role");
  }

  // Sell before buy
  if (lead.sell_before_buy === "no") {
    score += WEIGHTS.sell_before_buy_no;
    signals.push("no sell contingency");
  }

  // Multi-channel engagement
  const channels = new Set(recentEvents.map(e => e.channel).filter(Boolean));
  if (channels.size >= 2) {
    score += WEIGHTS.multiple_channels;
    signals.push(`${channels.size} channels engaged`);
  }

  // Recent touch
  const last24h = recentEvents.some(e => {
    if (!e.event_at) return false;
    return Date.now() - new Date(e.event_at).getTime() < 24 * 60 * 60 * 1000;
  });
  if (last24h) { score += WEIGHTS.recent_touch_24h; signals.push("active in last 24h"); }

  // Appointments
  if (appointmentCount > 0) {
    score += WEIGHTS.appointment_booked;
    signals.push(`${appointmentCount} appointment(s) booked`);
  }

  // Consent
  if (lead.call_consent === "yes") { score += WEIGHTS.call_consent; signals.push("call consent"); }
  if (lead.sms_consent === "yes") { score += WEIGHTS.sms_consent; signals.push("SMS consent"); }

  // Cap at 100
  score = Math.min(100, Math.round(score));

  // Tier
  const tier: LeadScoreResult["tier"] =
    score >= 65 ? "hot" :
    score >= 40 ? "warm" :
    score >= 20 ? "cool" : "cold";

  return { score, tier, signals, missing };
}

// ── DB write helper ───────────────────────────────────────────────────────────

export async function updateLeadScore(
  phone: string,
  email: string,
  scoreResult: LeadScoreResult
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const { Pool } = await import("pg");
  const { clientId } = await import("@/lib/database");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(
      `UPDATE lead_memory SET lead_score=$1, updated_at=now()
       WHERE client_id=$2 AND (
         ($3 <> '' AND regexp_replace(phone,'\\D','','g') LIKE '%'||$3) OR
         ($4 <> '' AND lower(email)=lower($4))
       )`,
      [
        scoreResult.score,
        clientId(),
        phone.replace(/\D/g, "").replace(/^1/, ""),
        email,
      ]
    );
  } finally {
    await pool.end();
  }
}
```

### Wire scoring into channelIngest

In `lib/channelIngest.ts`, after `upsertLeadMemoryToDatabase`, add:

```typescript
// ADD to imports:
import { computeLeadScore, updateLeadScore } from "@/lib/leadScoring";
import { findAppointmentsByPhone } from "@/lib/appointmentStore";

// ADD after lead upsert in recordChannelInteraction():
if (hasLeadIdentity && lead.phone) {
  try {
    const appointments = await findAppointmentsByPhone(lead.phone);
    const score = computeLeadScore({
      lead,
      recentEvents: events || [],
      appointmentCount: appointments.length,
    });
    await updateLeadScore(lead.phone, lead.email || "", score);

    // Slack hot lead alert if newly hot
    if (score.tier === "hot" && (lead.lead_score || 0) < 65) {
      const { notifySlackOnHotLead } = await import("@/lib/ariaSlack");
      await notifySlackOnHotLead({
        outcome: "HOT_LEAD",
        caller_phone: lead.phone,
        caller_name: lead.full_name,
        timeline: lead.timeline,
        property_address: lead.property_interest,
        notes: `Score: ${score.score}/100. Signals: ${score.signals.slice(0, 3).join(", ")}`,
        channel: input.channel,
      }).catch(() => {});
    }
  } catch {}
}
```

### Expose score in ariaMemory.ts

In `buildCallerContextResponse()`, add score context:

```typescript
// ADD to compileCallerContext(), after fetching appointments:
const { computeLeadScore } = await import("@/lib/leadScoring");
const score = computeLeadScore({
  lead,
  recentEvents: events,
  appointmentCount: allAppts.length,
});

// ADD to context_summary lines:
lines.push(`Lead score: ${score.score}/100 (${score.tier})`);
if (score.missing.length) lines.push(`Still unknown: ${score.missing.join(", ")}`);

// ADD to buildCallerContextResponse():
if (ctx.lead_score >= 65) {
  parts.push(`Hot lead — score ${ctx.lead_score}/100. Focus on booking.`);
} else if (ctx.lead_score >= 40) {
  parts.push(`Warm lead — score ${ctx.lead_score}/100. Still missing: ${score.missing.join(", ")}.`);
} else {
  parts.push(`Early stage — score ${ctx.lead_score}/100. Qualification is primary goal.`);
}
```

---

## ADDENDUM C — HUMAN HANDOFF (all channels)

### The full handoff framework

Every channel has three handoff types:

1. **Soft handoff** — agent gets a Slack/SMS alert, AI continues the thread
2. **Hard handoff** — AI stops responding, routes fully to human
3. **Emergency handoff** — immediate alert (compliance, legal, distress)

Triggers that apply to ALL channels:

```typescript
// lib/handoffRules.ts (NEW)

export type HandoffTrigger =
  | "requested_human"        // "let me speak to a person / agent / someone real"
  | "fair_housing"           // Section 8, schools by race, protected class questions
  | "legal_contract"         // contract terms, inspection objections, commission
  | "mortgage_lending"       // pre-approval advice, credit score guidance, NMLS questions
  | "angry_complaint"        // explicit anger, profanity toward the team, threats
  | "distress"               // foreclosure, divorce, job loss, urgent financial hardship
  | "repeated_contact"       // 4+ touches with no progress
  | "high_value_seller"      // seller lead with estimated value > $1M
  | "negotiation"            // offer strategy, counter-offer, multiple offers
  | "compliance_flag";       // TCPA STOP, DNC, legal opt-out language

export type HandoffResult = {
  shouldHandoff: boolean;
  trigger?: HandoffTrigger;
  reason?: string;
  urgency: "immediate" | "high" | "normal";
  type: "hard" | "soft";    // hard = AI stops; soft = AI continues + alert
};

const SENSITIVE_PATTERNS: Array<{
  pattern: RegExp;
  trigger: HandoffTrigger;
  urgency: HandoffResult["urgency"];
  type: HandoffResult["type"];
}> = [
  // Compliance — hard + immediate
  { pattern: /\b(stop|stopall|unsubscribe|cancel|end|quit|opt.?out|do not contact)\b/i,
    trigger: "compliance_flag", urgency: "immediate", type: "hard" },
  // Human request — hard
  { pattern: /\b(human|person|agent|real person|someone real|call me|representative|speak to)\b/i,
    trigger: "requested_human", urgency: "high", type: "hard" },
  // Fair housing — hard
  { pattern: /\b(section 8|voucher|children|kids|family friendly|safe neighborhood|ethnic|race|religion|disabled|disability|school rating|crime)\b/i,
    trigger: "fair_housing", urgency: "immediate", type: "hard" },
  // Legal/contract — hard
  { pattern: /\b(contract|offer terms|inspection objection|legal|lawsuit|attorney|commission|representation agreement)\b/i,
    trigger: "legal_contract", urgency: "high", type: "hard" },
  // Mortgage — soft (AI can give factual info, human handles guidance)
  { pattern: /\b(pre.?approv|prequalif|credit score|interest rate|down payment|nmls|apr|lender|mortgage)\b/i,
    trigger: "mortgage_lending", urgency: "normal", type: "soft" },
  // Anger — hard
  { pattern: /\b(angry|mad|upset|complaint|scam|stop lying|wtf|fuck|bullshit|terrible|sue)\b/i,
    trigger: "angry_complaint", urgency: "high", type: "hard" },
  // Distress — soft (AI remains supportive, human alerted)
  { pattern: /\b(foreclosure|divorce|job loss|lost my job|behind on|can't afford|bankruptcy|evict)\b/i,
    trigger: "distress", urgency: "immediate", type: "soft" },
  // Negotiation — soft
  { pattern: /\b(offer|counter.?offer|multiple offers|negotiat|how much should I|what should I offer)\b/i,
    trigger: "negotiation", urgency: "normal", type: "soft" },
];

export function checkHandoffTriggers(
  message: string,
  touchCount?: number
): HandoffResult {
  // Check touch count
  if (touchCount && touchCount >= 4) {
    return {
      shouldHandoff: true,
      trigger: "repeated_contact",
      reason: `${touchCount} touches with no conversion`,
      urgency: "normal",
      type: "soft",
    };
  }

  // Check message patterns
  for (const { pattern, trigger, urgency, type } of SENSITIVE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        shouldHandoff: true,
        trigger,
        reason: `Detected: ${trigger.replace(/_/g, " ")}`,
        urgency,
        type,
      };
    }
  }

  return { shouldHandoff: false, urgency: "normal", type: "soft" };
}

export function buildHandoffContextPacket(params: {
  channel: string;
  caller_name?: string;
  caller_phone?: string;
  caller_email?: string;
  trigger?: HandoffTrigger;
  reason?: string;
  lead?: Record<string, string>;
  recent_thread?: string;
  property_interest?: string;
  timeline?: string;
  budget?: string;
  lead_score?: number;
}): string {
  return [
    `=== HANDOFF FROM ${params.channel.toUpperCase()} ===`,
    `Trigger: ${params.trigger || "requested"} — ${params.reason || ""}`,
    ``,
    `LEAD:`,
    params.caller_name ? `  Name: ${params.caller_name}` : "",
    params.caller_phone ? `  Phone: ${params.caller_phone}` : "",
    params.caller_email ? `  Email: ${params.caller_email}` : "",
    ``,
    `CONTEXT:`,
    params.timeline ? `  Timeline: ${params.timeline}` : "",
    params.budget ? `  Budget: ${params.budget}` : "",
    params.property_interest ? `  Property interest: ${params.property_interest}` : "",
    params.lead_score !== undefined ? `  Lead score: ${params.lead_score}/100` : "",
    ``,
    params.recent_thread ? `RECENT THREAD:\n${params.recent_thread}` : "",
  ].filter(s => s !== undefined && s !== "").join("\n");
}
```

### Wire handoff into every channel

#### Theo (SMS/WhatsApp) — lib/theoAgent.ts

```typescript
// ADD to imports:
import { checkHandoffTriggers, buildHandoffContextPacket } from "@/lib/handoffRules";
import { notifySlackOnTransfer } from "@/lib/ariaSlack";
import { sendTheoHandoffAlert } from "@/lib/twilioSms";

// ADD near top of generateTheoReply(), after appointment check:
const handoff = checkHandoffTriggers(context.message, recentEvents?.length);
if (handoff.shouldHandoff && handoff.type === "hard") {
  const packet = buildHandoffContextPacket({
    channel: "sms",
    caller_phone: context.lead?.phone,
    caller_name: context.lead?.full_name,
    caller_email: context.lead?.email,
    trigger: handoff.trigger,
    reason: handoff.reason,
    timeline: context.lead?.timeline,
    budget: context.lead?.budget,
    property_interest: context.lead?.property_interest,
    lead_score: context.lead?.lead_score ? Number(context.lead.lead_score) : undefined,
    recent_thread: recentEvents?.slice(-3).map(e => `[${e.direction}] ${e.message_text}`).join("\n"),
  });

  // Alert agent
  await notifySlackOnTransfer({
    outcome: "TRANSFERRED",
    caller_phone: context.lead?.phone || "",
    caller_name: context.lead?.full_name,
    notes: packet,
    channel: "sms",
    tone: "neutral",
  }).catch(() => {});

  if (process.env.AGENT_PHONE) {
    await sendTheoHandoffAlert(
      process.env.AGENT_PHONE,
      `🚨 Handoff needed (${handoff.trigger?.replace(/_/g, " ")})\n${context.lead?.full_name || "Lead"} · ${context.lead?.phone || ""}\nCheck #agent-handoffs in Slack`
    ).catch(() => {});
  }

  // Generate safe reply for hard handoff
  const handoffReply = buildHandoffSmsReply(handoff.trigger);
  return {
    classification: {
      intent: "human_required",
      leadRole: context.lead?.lead_role || "",
      handoffReason: handoff.reason || "",
      status: "needs_human",
    },
    reply: handoffReply,
    mediaUrls: [],
    shouldSend: true,
    aiAction: "human_handoff",
    handoffReason: handoff.reason || "",
    status: "needs_human",
    metrics: [],
  };
}

function buildHandoffSmsReply(trigger?: HandoffTrigger): string {
  switch (trigger) {
    case "compliance_flag":
      return "You've been unsubscribed. No further messages will be sent.";
    case "requested_human":
      return "Absolutely — I'll have someone from our team reach out to you directly. What's the best time?";
    case "fair_housing":
      return "That's a great question for one of our agents who can discuss all the details with you. I'll have them reach out shortly.";
    case "legal_contract":
      return "That's something our agent should discuss with you directly. I'll have them reach out right away.";
    case "angry_complaint":
      return "I'm sorry to hear about your experience. I'll have a member of our team reach out to you personally.";
    case "distress":
      return "I understand — this sounds like an important situation. I'll make sure the right person reaches out to you today.";
    case "negotiation":
      return "That's exactly what our agents are best at helping with. I'll connect you with someone shortly.";
    default:
      return "I'll have one of our team members reach out to you directly. What's the best time to connect?";
  }
}
```

#### Iris (email) — agent.py additions

```python
# In agent.py, add handoff detection to classify_email_intent() or reply logic:

HANDOFF_PATTERNS = [
    (r'\b(human|person|agent|real person|call me|talk to someone)\b', 'requested_human', True),
    (r'\b(section 8|voucher|race|religion|disability|school rating)\b', 'fair_housing', True),
    (r'\b(contract|offer terms|inspection objection|legal|attorney|commission)\b', 'legal_contract', True),
    (r'\b(angry|mad|complaint|scam|terrible|sue|wtf)\b', 'angry_complaint', True),
    (r'\b(foreclosure|divorce|job loss|bankruptcy)\b', 'distress', False),  # soft
    (r'\b(pre.?approv|credit score|interest rate|lender|mortgage)\b', 'mortgage', False),  # soft
]

def detect_email_handoff(message_text: str) -> tuple[bool, str, bool]:
    """Returns (should_handoff, trigger, is_hard_handoff)"""
    for pattern, trigger, is_hard in HANDOFF_PATTERNS:
        if re.search(pattern, message_text, re.IGNORECASE):
            return True, trigger, is_hard
    return False, '', False

# In reply_to_email() or equivalent:
should_handoff, trigger, is_hard = detect_email_handoff(email_body)
if is_hard:
    # Label as NEEDS_HUMAN, alert agent, send safe reply
    gmail_label(msg_id, 'NEEDS_HUMAN')
    send_agent_sms_alert(f"Email handoff: {trigger} - {lead_email}")
    # Reply with safe handoff message (do NOT use AI for this)
    send_handoff_email_reply(to=lead_email, trigger=trigger)
    return
elif should_handoff:
    # Soft: AI answers what it safely can, flags for follow-up
    log.info(f"Soft handoff trigger: {trigger}")
    # Continue with AI reply but add note in classification
```

#### Olivia (web) — olivia-website route.ts

```typescript
// ADD to imports:
import { checkHandoffTriggers } from "@/lib/handoffRules";
import { notifySlackOnTransfer } from "@/lib/ariaSlack";

// ADD in POST handler, after lead record:
const webMessage = message || propertyInterest || "";
if (webMessage) {
  const handoff = checkHandoffTriggers(webMessage);
  if (handoff.shouldHandoff && handoff.type === "hard") {
    await notifySlackOnTransfer({
      outcome: "TRANSFERRED",
      caller_phone: phone,
      caller_name: fullName,
      notes: `Web form trigger: ${handoff.trigger} — ${handoff.reason}`,
      channel: "web",
      tone: "neutral",
    }).catch(() => {});
    // Don't send Theo SMS for hard handoffs — human will reach out
    smsStatus = "skipped_handoff";
    smsAction = "human_handoff_web";
  }
}
```

---

## ADDENDUM D — FULL QUALIFICATION FRAMEWORK (all channels)

### ISA qualification mile markers — applies to every channel

The same qualification framework baked into every agent's behavior.
All channels collect the same 8 fields in the same priority order.

```typescript
// lib/qualificationFramework.ts (NEW)
// Shared qualification logic used by Theo, Iris, Olivia, and Aria.
// Defines the mile markers, question bank, and scoring contribution.

export type QualificationField =
  | "lead_role"          // buyer | seller | renter | investor
  | "preferred_channel"  // voice | sms | email
  | "timeline"           // when do they want to move
  | "area"               // target neighborhood/city
  | "budget"             // price range
  | "bedrooms"           // bedroom preference
  | "sell_before_buy"    // do they need to sell first?
  | "pre_approval";      // are they pre-approved? (derived from text)

// Priority order — ask in this sequence when fields are missing
export const QUALIFICATION_ORDER: QualificationField[] = [
  "preferred_channel",
  "timeline",
  "area",
  "budget",
  "bedrooms",
  "sell_before_buy",
  "pre_approval",
];

// Next best question for each channel
export const QUALIFICATION_QUESTIONS: Record<
  QualificationField,
  { sms: string; voice: string; email: string }
> = {
  preferred_channel: {
    sms: "Quick question — is texting the best way to reach you, or do you prefer calls or email?",
    voice: "What's the best way for our team to follow up — text, call, or email?",
    email: "", // don't ask in email — they already chose email
  },
  timeline: {
    sms: "Are you looking to move in the next few months, or is this more of a longer-term plan?",
    voice: "Are you thinking about making a move in the next few months, or is this more of a longer-term thing?",
    email: "Are you actively looking to move soon, or is this more exploratory for now?",
  },
  area: {
    sms: "What area or neighborhood are you most interested in?",
    voice: "What area are you focused on — is it Austin specifically, or are you open to surrounding areas like Round Rock or Cedar Park?",
    email: "Which neighborhoods or areas are you most interested in?",
  },
  budget: {
    sms: "What price range are you working with?",
    voice: "Just so I have the right context — what's the price range you're looking at?",
    email: "What price range are you working with?",
  },
  bedrooms: {
    sms: "How many bedrooms do you need?",
    voice: "How many bedrooms are you looking for?",
    email: "How many bedrooms are you looking for?",
  },
  sell_before_buy: {
    sms: "Do you have a home to sell before buying, or are you in a position to move when you find the right place?",
    voice: "Are you in a position to move when you find the right place, or do you have a home to sell first?",
    email: "Do you have a home to sell first, or are you free to purchase when the right property comes up?",
  },
  pre_approval: {
    sms: "Have you talked to a lender yet, or is that still on your to-do list?",
    voice: "Have you connected with a lender yet to get pre-approved?",
    email: "Have you connected with a lender to get pre-approved, or is that still a next step?",
  },
  lead_role: {
    sms: "Are you looking to buy, sell, or rent?",
    voice: "Are you looking to buy a home, sell one, or both?",
    email: "Are you looking to buy, sell, or do both?",
  },
};

// Get the next question to ask given current lead state
export function getNextQualificationQuestion(
  lead: Partial<Record<string, string>>,
  channel: "sms" | "voice" | "email"
): { field: QualificationField; question: string } | null {
  for (const field of QUALIFICATION_ORDER) {
    const hasValue = lead[field] && (lead[field] as string).trim();
    if (!hasValue) {
      const question = QUALIFICATION_QUESTIONS[field][channel];
      if (question) return { field, question };
    }
  }
  return null; // fully qualified
}

// Build a qualification summary for agents
export function buildQualificationSummary(
  lead: Partial<Record<string, string>>
): { complete: string[]; missing: string[] } {
  const complete: string[] = [];
  const missing: string[] = [];

  const checks: Array<[string, string]> = [
    ["lead_role", "Role"],
    ["timeline", "Timeline"],
    ["area", "Area"],
    ["budget", "Budget"],
    ["bedrooms", "Bedrooms"],
    ["sell_before_buy", "Sell before buy"],
    ["preferred_channel", "Preferred channel"],
  ];

  for (const [field, label] of checks) {
    if (lead[field]?.trim()) {
      complete.push(`${label}: ${lead[field]}`);
    } else {
      missing.push(label);
    }
  }

  return { complete, missing };
}
```

### Wire into Theo's LLM prompt

In `lib/theoLlm.ts`, add qualification next-question logic to context:

```typescript
// ADD to imports:
import { getNextQualificationQuestion, buildQualificationSummary } from "@/lib/qualificationFramework";

// ADD before building user message:
const qualNext = getNextQualificationQuestion(context.lead || {}, "sms");
const qualSummary = buildQualificationSummary(context.lead || {});

// ADD to user message:
const qualContext = [
  qualSummary.complete.length ? `Known: ${qualSummary.complete.join(", ")}` : "",
  qualSummary.missing.length ? `Missing: ${qualSummary.missing.join(", ")}` : "",
  qualNext ? `Suggested next question: "${qualNext.question}"` : "Lead fully qualified.",
].filter(Boolean).join("\n");

// Include qualContext in user message passed to Claude
```

### Wire into Aria's system prompt

In `lib/ariaAssistant.ts` systemPrompt(), reference the qualification framework
in the discovery section — the framework is already baked in, but add:

```typescript
// In systemPrompt(), add to QUALIFICATION section:
`Qualification priority order when fields are missing:
1. Preferred follow-up channel
2. Timeline (most predictive of intent)
3. Area/neighborhood
4. Budget
5. Bedrooms
6. Sell before buy (critical for deal structure)
7. Pre-approval status

Ask one question per turn. If context from getCallerContext shows a field is
already known, skip that question entirely and reference it naturally instead.`
```

---

## ADDENDUM E — UPDATED ENV VARS (complete .env.example)

```bash
# ── Aria / VAPI ───────────────────────────────────────────────────────────────
VAPI_API_KEY=
ARIA_VOICE_ID=Paige
ARIA_MODEL=claude-sonnet-4-6
ARIA_MODEL_PROVIDER=anthropic
ARIA_ENRICHMENT_TIMEOUT_MS=3500
ARIA_PHONE_NUMBER_ID=
ARIA_ASSISTANT_ID=
HUMAN_TRANSFER_NUMBER=+1xxxxxxxxxx
ARIA_OUTBOUND_PAUSED=false

# ── Calendar (pick one primary, others become link-based fallbacks) ────────────
CALENDAR_PROVIDER=ghl       # ghl | google | calendly | outlook | acuity | showingtime | link
GHL_CALENDAR_ID=
GHL_PRIVATE_INTEGRATION_TOKEN=
GOOGLE_CALENDAR_ID=
GOOGLE_CALENDAR_CREDENTIALS_PATH=google_calendar_credentials.json
CALENDLY_URL=https://calendly.com/youragent/30min
OUTLOOK_BOOKINGS_URL=
ACUITY_URL=
SHOWINGTIME_URL=
BOOKING_LINK_URL=            # Generic fallback
CALENDAR_TIMEZONE=America/Chicago
SEND_BOOKING_CONFIRMATION_SMS=true
VERIFY_INBOUND_CALLER=true

# ── Slack ─────────────────────────────────────────────────────────────────────
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=
SLACK_HOTLEAD_CHANNEL=#hot-leads
SLACK_HANDOFF_CHANNEL=#agent-handoffs
SLACK_DAILY_DIGEST_CHANNEL=#aria-daily

# ── GoHighLevel ───────────────────────────────────────────────────────────────
GHL_LOCATION_ID=
GHL_CONTACT_TAG_VOICE=aria-voice
GHL_SYNC_MODE=live

# ── Agent SMS control ─────────────────────────────────────────────────────────
ARIA_SMS_CONTROL_NUMBER=+1xxxxxxxxxx
AGENT_PHONE=+1xxxxxxxxxx
ENABLE_ARIA_SMS_CONTROL=true

# ── Lead scoring ──────────────────────────────────────────────────────────────
HOT_LEAD_SCORE_THRESHOLD=65    # Score at which Slack hot-lead alert fires
WARM_LEAD_SCORE_THRESHOLD=40

# ── Cross-channel ─────────────────────────────────────────────────────────────
ENABLE_CROSS_CHANNEL_BOOKING=true
CHANNEL_WEBHOOK_SECRET=
PUBLIC_BASE_URL=https://your-domain.com
```

---

## ADDENDUM F — UPDATED FILES SUMMARY (complete)


| File                                              | Action  | Purpose                                                                 |
| ------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `db/migrations/004_aria_appointments.sql`         | CREATE  | Shared appointments table                                               |
| `db/migrations/005_lead_memory_improvements.sql`  | CREATE  | Score, bedrooms, handoff fields                                         |
| `lib/appointmentStore.ts`                         | CREATE  | Single Neon appointment interface                                       |
| `lib/ariaCalendar.ts`                             | CREATE  | All calendar providers (GHL/Google/Calendly/Outlook/Acuity/ShowingTime) |
| `lib/ariaMemory.ts`                               | CREATE  | Cross-channel context compiler                                          |
| `lib/ariaSlack.ts`                                | CREATE  | Slack notifications (BOOKED/TRANSFER/HOT_LEAD)                          |
| `lib/leadScoring.ts`                              | CREATE  | 0-100 lead score, all channels                                          |
| `lib/handoffRules.ts`                             | CREATE  | Handoff triggers + context packet, all channels                         |
| `lib/qualificationFramework.ts`                   | CREATE  | ISA qualification mile markers, all channels                            |
| `lib/ariaAssistant.ts`                            | REPLACE | Complete Aria/VAPI config                                               |
| `lib/ariaTools.ts`                                | EDIT    | +4 tool cases (book/cancel/reschedule/memory)                           |
| `lib/theoAppointments.ts`                         | CREATE  | Theo SMS booking/cancel/reschedule                                      |
| `lib/theoAgent.ts`                                | EDIT    | Appointment intercept + handoff + scoring                               |
| `lib/theoLlm.ts`                                  | EDIT    | Cross-channel context + qualification next-Q                            |
| `lib/ariaSmsControl.ts`                           | CREATE  | Agent SMS control of Aria outbound                                      |
| `lib/channelIngest.ts`                            | EDIT    | Wire lead scoring on every ingest                                       |
| `lib/sheetSchema.ts`                              | EDIT    | New fields for score/bedrooms/handoff                                   |
| `agent.py`                                        | EDIT    | Handoff detection + personalized Calendly CTA                           |
| `app/api/webhooks/iris-book-appointment/route.ts` | CREATE  | Iris → Neon appointment write                                           |
| `app/api/webhooks/olivia-website/route.ts`        | EDIT    | Booking + hot lead + handoff                                            |
| `app/api/webhooks/aria-sms-control/route.ts`      | CREATE  | Agent SMS commands                                                      |
| `scripts/aria-provision.mjs`                      | REPLACE | VAPI CLI + SDK deploy                                                   |
