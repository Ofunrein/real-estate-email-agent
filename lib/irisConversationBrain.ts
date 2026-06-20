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
  const needsHuman = humanRisk(latestText);
  const propertyDraft = !needsHuman ? draftForProperty(input) : "";
  const draft = needsHuman
    ? "I'm going to have a real person follow up on that so we handle it correctly."
    : propertyDraft || draftForGeneral(input);
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
