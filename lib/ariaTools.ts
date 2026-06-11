// Aria's server-side tool dispatcher. Vapi runs the conversation; when the
// assistant invokes a server tool, the webhook route calls runAriaTool() and
// gets back a spoken `result` string (read to the caller) plus an `ingest`
// record the route persists via recordChannelInteraction (one conversation
// event per tool, and lead upsert for qualifyLead).
//
// transferToHuman and endCall are Vapi-native tools configured on the assistant
// (lib/ariaAssistant.ts) and never reach this dispatcher.
//
// Pure except for the two injected async deps, so it is unit-testable.

import type { ChannelIngestInput } from "@/lib/channelIngest";
import { resolveCaller as resolveCallerDefault, type CallerIdentity } from "@/lib/identity";
import {
  lookupPropertyForVoice,
  searchPropertiesForVoice,
  type VoiceLookupResult,
  type VoiceSearchResult,
} from "@/lib/ariaData";
import {
  cancelShowing,
  rescheduleShowing,
  scheduleShowing,
  type ShowingContact,
} from "@/lib/calendar";
import { resolveCrmAdapter } from "@/lib/crm";
import type { CrmAdapter } from "@/lib/crm/types";
import { clientConfig } from "@/lib/clientConfig";
import type { SheetRow } from "@/lib/sheetSchema";

export type AriaToolName =
  | "getCallerContext"
  | "lookupProperty"
  | "searchProperties"
  | "scheduleShowing"
  | "syncToCrm"
  | "qualifyLead";

export type AriaToolContext = {
  phone: string;
  callId: string;
  threadRef: string;
  lead?: Partial<SheetRow> | null;
};

export type AriaToolDeps = {
  resolveCaller: (phone: string) => Promise<CallerIdentity>;
  lookupProperty: (input: { address: string; phone?: string; message?: string; lead?: Partial<SheetRow> }) => Promise<VoiceLookupResult>;
  searchProperties: (input: { query?: string; area?: string; beds?: number; baths?: number; minPrice?: number; maxPrice?: number; phone?: string; lead?: Partial<SheetRow> }) => Promise<VoiceSearchResult>;
  getCrm: () => CrmAdapter | null;
  calendarId: string;
  timezone: string;
};

const defaultDeps: AriaToolDeps = {
  resolveCaller: resolveCallerDefault,
  lookupProperty: lookupPropertyForVoice,
  searchProperties: searchPropertiesForVoice,
  getCrm: () => resolveCrmAdapter(),
  calendarId: process.env.GHL_CALENDAR_ID || "",
  timezone: process.env.CALENDAR_TIMEZONE || "America/Chicago",
};

export type AriaToolOutcome = {
  result: string; // spoken back to the caller
  ingest: ChannelIngestInput; // persisted by the route
};

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function consent(value: unknown): string {
  const text = str(value).toLowerCase();
  if (!text) return "";
  return ["1", "true", "yes", "y", "on", "sure", "ok", "okay", "consent"].includes(text) ? "yes" : "no";
}

function baseIngest(ctx: AriaToolContext): ChannelIngestInput {
  return {
    channel: "voice",
    direction: "inbound",
    agentName: "Aria",
    phone: ctx.phone,
    source: "vapi",
    threadRef: ctx.threadRef,
    preferredChannel: "voice",
    status: "received",
  };
}

async function hydrateContext(ctx: AriaToolContext, deps: AriaToolDeps): Promise<AriaToolContext> {
  if (ctx.lead || !ctx.phone) return ctx;
  try {
    const identity = await deps.resolveCaller(ctx.phone);
    return identity.lead ? { ...ctx, lead: identity.lead } : ctx;
  } catch {
    return ctx;
  }
}

function getCallerContext(ctx: AriaToolContext, identity: CallerIdentity): AriaToolOutcome {
  const ingest: ChannelIngestInput = {
    ...baseIngest(ctx),
    eventType: "voice_caller_context",
    aiAction: identity.matched ? "caller_matched" : "caller_unknown",
  };

  if (!identity.matched || !identity.lead) {
    return {
      result: "New caller. No prior record. Greet naturally and offer to help.",
      ingest: { ...ingest, summary: "Inbound call from an unrecognized number." },
    };
  }

  const lead = identity.lead;
  const name = str(lead.full_name);
  const interest = str(lead.property_interest) || str(lead.area);
  const role = str(lead.lead_role);
  const budget = str(lead.budget);

  // Return structured context for the AI to use naturally — NOT as a greeting instruction.
  // Only include name if actually known (not blank). AI should use this context silently
  // and work it into conversation naturally, NOT announce "welcome back" or say they called before.
  const contextParts = [
    name ? `Caller name: ${name}.` : "",
    role ? `Role: ${role}.` : "",
    interest ? `Property interest: ${interest}.` : "",
    budget ? `Budget: ${budget}.` : "",
    identity.channelsSeen.length ? `Prior contact channels: ${identity.channelsSeen.join(", ")}.` : "",
    identity.lastTouchAt ? `Last contact: ${identity.lastTouchAt.slice(0, 10)}.` : "",
  ].filter(Boolean).join(" ");

  return {
    result: contextParts || "Returning caller. No detailed profile. Greet naturally.",
    ingest: {
      ...ingest,
      fullName: name,
      email: str(lead.email),
      propertyInterest: str(lead.property_interest),
      summary: `Context loaded for${name ? ` ${name}` : " caller"}.`,
    },
  };
}

async function lookupProperty(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const address = str(args.address || args.property || args.query);
  const lookup = await deps.lookupProperty({
    address,
    phone: ctx.phone,
    message: str(args.message) || address,
    lead: ctx.lead || undefined,
  });
  const confirmedInterest = str(lookup.properties[0]?.address) || str(ctx.lead?.property_interest);
  return {
    result: lookup.spoken,
    ingest: {
      ...baseIngest(ctx),
      eventType: "voice_property_lookup",
      messageText: address,
      propertyInterest: confirmedInterest,
      aiAction: lookup.timedOut ? "property_lookup_async_sms" : "property_lookup",
      summary: lookup.spoken,
    },
  };
}

function num(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function searchProperties(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const query = str(args.query || args.text);
  const area = str(args.area || args.location);
  const search = await deps.searchProperties({
    query,
    area,
    beds: num(args.beds),
    baths: num(args.baths),
    minPrice: num(args.minPrice ?? args.min_price),
    maxPrice: num(args.maxPrice ?? args.max_price),
    phone: ctx.phone,
    lead: ctx.lead || undefined,
  });
  const criteria = [area || query, args.beds ? `${args.beds}bd` : "", args.maxPrice ? `<=${args.maxPrice}` : ""]
    .filter(Boolean)
    .join(" ");
  return {
    result: search.spoken,
    ingest: {
      ...baseIngest(ctx),
      eventType: "voice_property_search",
      messageText: criteria,
      aiAction: search.timedOut ? "property_search_async_sms" : search.properties.length ? "property_search_results" : "property_search_empty",
      summary: `Voice property search (${criteria || "general"}) → ${search.properties.length} matches.`,
    },
  };
}

function contactFromCtx(ctx: AriaToolContext, args: Record<string, unknown>): ShowingContact {
  return {
    phone: ctx.phone,
    email: str(args.email).toLowerCase() || str(ctx.lead?.email).toLowerCase(),
    fullName: str(args.name || args.full_name) || str(ctx.lead?.full_name),
  };
}

async function scheduleShowingTool(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const action = (str(args.action) || "book").toLowerCase();
  const adapter = deps.getCrm();
  const ingestBase = { ...baseIngest(ctx), eventType: "voice_schedule_showing" };

  if (!adapter || !deps.calendarId) {
    return {
      result: "Scheduling isn't connected yet, but I'll have a team member set that up and follow up with you.",
      ingest: { ...ingestBase, aiAction: "scheduling_unavailable", summary: "Scheduling requested but CRM/calendar not configured." },
    };
  }

  const contact = contactFromCtx(ctx, args);
  if (!contact.phone && !contact.email) {
    return {
      result: "Before I book that, can I get the best phone or email for the appointment?",
      ingest: { ...ingestBase, aiAction: "scheduling_needs_identity", summary: "Scheduling blocked: no caller identity to attach." },
    };
  }

  if (action === "cancel") {
    const result = await cancelShowing(adapter, { contact });
    return {
      result: result.spoken,
      ingest: { ...ingestBase, aiAction: result.ok ? "showing_cancelled" : "showing_cancel_failed", summary: result.spoken },
    };
  }

  if (action === "reschedule") {
    const newStart = str(args.newStartTime || args.new_start_time || args.startTime || args.start_time);
    if (!newStart) {
      return { result: "What new day and time works for the showing?", ingest: { ...ingestBase, aiAction: "showing_reschedule_needs_time", summary: "Reschedule requested without a new time." } };
    }
    const result = await rescheduleShowing(adapter, { contact, newStartTime: newStart, timezone: deps.timezone });
    return {
      result: result.spoken,
      ingest: { ...ingestBase, aiAction: result.ok ? "showing_rescheduled" : "showing_reschedule_failed", summary: result.spoken },
    };
  }

  const startTime = str(args.startTime || args.start_time || args.time);
  if (!startTime) {
    return { result: "What day and time would you like to tour it?", ingest: { ...ingestBase, aiAction: "showing_needs_time", summary: "Booking requested without a time." } };
  }
  const address = str(args.address || args.property || ctx.lead?.property_interest);
  const result = await scheduleShowing(adapter, {
    calendarId: deps.calendarId,
    contact,
    startTime,
    endTime: str(args.endTime || args.end_time) || undefined,
    timezone: deps.timezone,
    address: address || undefined,
  });
  return {
    result: result.spoken,
    ingest: {
      ...ingestBase,
      fullName: contact.fullName || "",
      email: contact.email || "",
      propertyInterest: address,
      aiAction: "showing_booked",
      nextAction: "showing_scheduled",
      summary: result.spoken,
    },
  };
}

async function syncToCrm(ctx: AriaToolContext, args: Record<string, unknown>, deps: AriaToolDeps): Promise<AriaToolOutcome> {
  const adapter = deps.getCrm();
  const ingestBase = { ...baseIngest(ctx), eventType: "voice_crm_sync" };
  if (!adapter) {
    return { result: "Noted.", ingest: { ...ingestBase, aiAction: "crm_sync_skipped", summary: "CRM not configured; sync skipped." } };
  }
  const contact = contactFromCtx(ctx, args);
  if (!contact.phone && !contact.email) {
    return { result: "Noted.", ingest: { ...ingestBase, aiAction: "crm_sync_skipped", summary: "CRM sync skipped: no caller identity." } };
  }
  const upserted = await adapter.upsertContact({ phone: contact.phone, email: contact.email, fullName: contact.fullName });
  const note = str(args.note || args.summary) || "Voice call handled by Aria.";
  await adapter.logActivity({ contactId: upserted.id, body: note, channel: "voice", direction: "inbound", type: "note" });
  return {
    result: "Done, I've saved that to your record.",
    ingest: { ...ingestBase, fullName: contact.fullName || "", email: contact.email || "", aiAction: "crm_synced", summary: `Synced to CRM: ${note}` },
  };
}

function qualifyLead(ctx: AriaToolContext, args: Record<string, unknown>): AriaToolOutcome {
  const fullName = str(args.name || args.full_name || args.fullName);
  const email = str(args.email).toLowerCase();
  const role = str(args.role || args.lead_role || args.leadRole);
  const budget = str(args.budget);
  const timeline = str(args.timeline);
  const area = str(args.area || args.location);
  const bedrooms = str(args.bedrooms || args.beds);
  const bathrooms = str(args.bathrooms || args.baths);
  const preferredChannel = str(args.preferred_channel || args.preferredChannel);
  const interest = str(args.property || args.property_interest || args.propertyInterest || args.address);
  const callConsent = consent(args.call_consent ?? args.callConsent);
  const smsConsent = consent(args.sms_consent ?? args.smsConsent);

  const confirmBits = [
    role ? `a ${role}` : "your details",
    budget ? `budget ${budget}` : "",
    area ? `in ${area}` : "",
    bedrooms ? bedrooms : "",
    bathrooms ? bathrooms : "",
    timeline ? `timeline ${timeline}` : "",
  ].filter(Boolean).join(", ");

  return {
    result: `Got it — I've noted ${confirmBits}. A team member will follow up.`,
    ingest: {
      ...baseIngest(ctx),
      fullName,
      email,
      eventType: "voice_qualify",
      leadRole: role,
      intent: role ? `${role}_lead` : "",
      propertyInterest: interest,
      preferredChannel,
      callConsent,
      smsConsent,
      aiAction: "lead_qualified",
      nextAction: "review_or_followup",
      summary: [
        "Voice lead qualified.",
        role ? `role=${role}` : "",
        budget ? `budget=${budget}` : "",
        area ? `area=${area}` : "",
        bedrooms ? `beds=${bedrooms}` : "",
        bathrooms ? `baths=${bathrooms}` : "",
        timeline ? `timeline=${timeline}` : "",
        preferredChannel ? `preferred_channel=${preferredChannel}` : "",
        interest ? `interest=${interest}` : "",
      ].filter(Boolean).join(" "),
    },
  };
}

export async function runAriaTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AriaToolContext,
  deps: AriaToolDeps = defaultDeps,
): Promise<AriaToolOutcome> {
  switch (name) {
    case "getCallerContext": {
      const identity = await deps.resolveCaller(ctx.phone);
      return getCallerContext(ctx, identity);
    }
    case "lookupProperty":
      return lookupProperty(await hydrateContext(ctx, deps), args, deps);
    case "searchProperties":
      return searchProperties(await hydrateContext(ctx, deps), args, deps);
    case "scheduleShowing":
      return scheduleShowingTool(await hydrateContext(ctx, deps), args, deps);
    case "syncToCrm":
      return syncToCrm(await hydrateContext(ctx, deps), args, deps);
    case "qualifyLead":
      return qualifyLead(ctx, args);
    default:
      return {
        result: `Unknown tool: ${name}.`,
        ingest: {
          ...baseIngest(ctx),
          eventType: "voice_tool_unknown",
          aiAction: "tool_unknown",
          summary: `Unknown Aria tool requested: ${name}.`,
          status: "error",
        },
      };
  }
}
