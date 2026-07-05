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

function draftForReview(input: IrisBrainInput): string {
  const name = latestLeadName(input.lead, input.events);
  const prefix = name ? `${name}, ` : "";
  const text = clean(input.latestMessage);
  if (/\b(section 8|voucher)\b/i.test(text)) return `${prefix}thanks for sharing that. Send me the address or area you want, and I will check which available homes fit the voucher requirements before I send options.`;
  if (/\b(school|crime|safe neighborhood)\b/i.test(text)) return `${prefix}I can help narrow this down. For schools and neighborhood fit, I will point you to the official resources and send homes that match your price, commute, and area preferences. What area should I start with?`;
  if (/\b(pre.?approved|mortgage|credit score|financ)\b/i.test(text)) return `${prefix}that makes sense. What price range are you comfortable with, and are you already pre-approved or still comparing financing options?`;
  if (/\b(legal|contract|commission)\b/i.test(text)) return `${prefix}I can help with the next step here. Send me the property or question you want checked, and I will keep the reply specific while we verify anything that needs exact contract guidance.`;
  if (/\b(angry|complaint|upset)\b/i.test(text)) return `${prefix}I hear you. Send me what happened and the best outcome you want, and I will help get this cleaned up quickly.`;
  return `${prefix}I can help with that. Send me the property, area, budget, or timeline you want to focus on, and I will narrow it down from here.`;
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
    ? draftForReview(input)
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
