import crypto from "node:crypto";

import { inferCategorySlug, type InboxCategory } from "@/lib/inboxSettings";
import type { Channel } from "@/lib/inboxData";
import type { SheetRow } from "@/lib/sheetSchema";

export type IrisBrainInput = {
  channel: Exclude<Channel, "voice" | "unknown">;
  threadRef: string;
  latestMessage: string;
  events: SheetRow[];
  lead?: Partial<SheetRow>;
  properties?: SheetRow[];
  categories?: InboxCategory[];
};

export type IrisBrainOutput = {
  draft: string;
  category: string;
  confidence: number;
  reason: string;
  next_action: string;
  needs_human: boolean;
  safe_to_auto_send: boolean;
  memory_patch: Partial<SheetRow>;
  property_context_used: string[];
  fingerprint: string;
};

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function facts(property: SheetRow): string {
  return [
    property.address,
    property.price ? `${property.price}` : "",
    property.beds ? `${property.beds} bed` : "",
    property.baths ? `${property.baths} bath` : "",
    property.sqft ? `${property.sqft} sqft` : "",
    property.neighborhood || property.city || "",
  ].filter(Boolean).join(", ");
}

function latestLeadName(lead?: Partial<SheetRow>, events: SheetRow[] = []) {
  const latest = events[events.length - 1] || {};
  return clean(lead?.full_name || latest.full_name).split(/\s+/)[0] || "";
}

function humanRisk(text: string) {
  return /\b(section 8|voucher|safe neighborhood|crime|school|pre.?approved|mortgage|credit score|legal|contract|commission|angry|complaint|human|person|agent)\b/i.test(text);
}

// Lesson from prior RE builds: disqualify BEFORE drafting. The flow used to reply
// with full energy to junk (gibberish, fake numbers, out-of-area, browsers), which
// generated noise follow-up tasks. Filter first, draft second.
const SERVICE_AREA = /\b(round rock|austin|pflugerville|cedar park|georgetown|leander|hutto|kyle|buda|manor|taylor|del valle|lakeway|bee cave|dripping springs)\b/i;

function disqualify(input: IrisBrainInput): { reason: string } | null {
  const text = clean(input.latestMessage);
  const lead = input.lead || {};
  const compact = text.replace(/\s+/g, "");
  // gibberish / empty: no vowels or too short to carry intent
  if (compact.length > 0 && compact.length < 4) return { reason: "junk: message too short to carry intent" };
  if (/^[a-z]{4,}$/i.test(compact) && !/[aeiou]/i.test(compact)) return { reason: "junk: gibberish (no vowels)" };
  if (/\b(asdf|qwer|test123|zxcv|jkl;)\b/i.test(text)) return { reason: "junk: keyboard-mash marker" };
  // fake phone: repeated/sequential digits like 0000000000 or 1234567890
  const phone = clean(lead.phone).replace(/\D/g, "");
  if (phone && (/^(\d)\1{6,}$/.test(phone) || phone === "1234567890" || phone.length < 7)) {
    return { reason: "junk: fake or invalid phone number" };
  }
  // out-of-area: an explicit non-service metro named with no service-area token
  if (/\b(dallas|houston|san antonio|new york|los angeles|miami|chicago|phoenix|denver|seattle)\b/i.test(text) && !SERVICE_AREA.test(text)) {
    return { reason: "out-of-area: named metro outside service area" };
  }
  return null;
}

// Lesson: the FIRST touch should be short — the lead just wants to know a human is
// alive, not a mini-essay. Save detailed property context for touch 2+.
function isFirstTouch(input: IrisBrainInput): boolean {
  const outbound = (input.events || []).filter((e) => clean(e.direction) === "outbound");
  return outbound.length === 0;
}

function draftForProperty(input: IrisBrainInput): string {
  const property = input.properties?.find((row) => clean(row.address));
  if (!property) return "";
  const text = clean(input.latestMessage);
  if (/\b(photo|picture|image|look like)\b/i.test(text)) {
    return `I can send photos for ${clean(property.address)}. It is ${facts(property)}.${property.listing_url ? ` Listing: ${clean(property.listing_url)}` : ""}`;
  }
  if (/\b(amenit|feature|parking|garage|pool|washer|dryer|balcony|yard|pet)\b/i.test(text)) {
    return `${clean(property.address)} shows these saved features: ${clean(property.features) || "the saved record does not list extra amenities yet"}. Want me to compare it against another option or help set up a showing?`;
  }
  if (/\b(showing|tour|see it|view it|book|schedule)\b/i.test(text)) {
    return `${clean(property.address)} works. What day and time should I try for the showing?`;
  }
  return `${facts(property)}.${property.listing_url ? ` Listing: ${clean(property.listing_url)}` : ""} Want photos, a showing, or similar options?`;
}

function draftForGeneral(input: IrisBrainInput): string {
  const firstName = latestLeadName(input.lead, input.events);
  const prefix = firstName ? `${firstName}, ` : "";
  const text = clean(input.latestMessage);
  if (/\b(sell|valuation|home value|list my)\b/i.test(text)) {
    return `${prefix}I can help with the valuation path. What address should we price, and are you thinking about selling soon or just checking value?`;
  }
  if (/\b(round rock|austin|pflugerville|cedar park|georgetown|leander|warwick|downtown)\b/i.test(text)) {
    return `${prefix}got it. I can narrow that search. What budget ceiling and bedroom count should I hold to?`;
  }
  return `${prefix}I can help. Are you looking for listing details, photos, a showing, or a fresh search?`;
}

export function runIrisConversationBrain(input: IrisBrainInput): IrisBrainOutput {
  const category = inferCategorySlug(input.events, input.categories);
  const latestText = clean(input.latestMessage || input.events[input.events.length - 1]?.message_text || "");
  const propertyContext = (input.properties || []).map((property) => clean(property.address)).filter(Boolean).slice(0, 3);
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      channel: input.channel,
      threadRef: input.threadRef,
      latestText,
      propertyContext,
      category,
    }))
    .digest("hex");

  // Filter before flow: never auto-reply to junk / out-of-area. Flag for review, no send.
  const dq = disqualify(input);
  if (dq) {
    return {
      draft: "",
      category: "disqualified",
      confidence: 0.9,
      reason: dq.reason,
      next_action: "skip_no_reply",
      needs_human: false,
      safe_to_auto_send: false,
      memory_patch: { disqualified: "true", disqualified_reason: dq.reason },
      property_context_used: propertyContext,
      fingerprint,
    };
  }

  const needsHuman = humanRisk(latestText);
  const propertyDraft = !needsHuman ? draftForProperty(input) : "";
  let draft = needsHuman
    ? "I'm going to have a real person follow up on that so we handle it correctly."
    : propertyDraft || draftForGeneral(input);

  // Short first touch: the lead just wants to know someone is alive. Keep it to a
  // quick ack + time ask; detailed property context comes on later touches.
  if (!needsHuman && isFirstTouch(input)) {
    const firstName = latestLeadName(input.lead, input.events);
    const prefix = firstName ? `${firstName}, ` : "";
    const addr = propertyContext[0];
    draft = addr
      ? `${prefix}got your inquiry on ${addr}. I'm free to chat today or tomorrow, what time works?`
      : `${prefix}got your inquiry. I'm free to chat today or tomorrow, what time works?`;
  }

  return {
    draft,
    category: needsHuman ? "needs_human" : category,
    confidence: propertyDraft ? 0.82 : needsHuman ? 0.55 : 0.64,
    reason: propertyDraft ? "Resolved against recent property context." : needsHuman ? "Sensitive or human-requested topic." : "General lead follow-up.",
    next_action: needsHuman ? "mark_human" : "review_draft",
    needs_human: needsHuman,
    safe_to_auto_send: Boolean(propertyDraft && !needsHuman),
    memory_patch: {},
    property_context_used: propertyContext,
    fingerprint,
  };
}
