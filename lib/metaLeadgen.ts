import { inferPreferredChannelFromText, type ChannelIngestInput } from "@/lib/channelIngest";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { normalizePhone } from "@/lib/leadIdentity";

export type MetaLeadgenField = {
  name: string;
  values?: unknown[];
};

export type MetaLeadgenLead = {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  field_data?: MetaLeadgenField[];
};

export type MetaLeadgenNormalized = {
  leadId: string;
  fullName: string;
  email: string;
  phone: string;
  message: string;
  preferredChannel: "sms" | "email" | "voice" | "whatsapp" | "messenger" | "instagram" | "website_chat";
  smsConsent: string;
  callConsent: string;
  whatsappConsent: string;
  intent: string;
  leadRole: string;
  budget: string;
  area: string;
  bedrooms: string;
  bathrooms: string;
  timeline: string;
  propertyInterest: string;
  summary: string;
  sourceDetail: string;
  providerMetadata: Record<string, unknown>;
};

const NAME_KEYS = new Set(["full_name", "name", "first_name", "last_name"]);
const EMAIL_KEYS = new Set(["email", "email_address"]);
const PHONE_KEYS = new Set(["phone", "phone_number", "mobile", "mobile_phone"]);

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function fieldValue(field: MetaLeadgenField): string {
  const values = Array.isArray(field.values) ? field.values.map(clean).filter(Boolean) : [];
  return values.join(", ");
}

function normalizedKey(value = ""): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function valueByKey(fields: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const exact = fields[normalizedKey(key)];
    if (exact) return exact;
  }
  const entries = Object.entries(fields);
  for (const key of keys) {
    const needle = normalizedKey(key);
    const match = entries.find(([candidate]) => candidate.includes(needle) || needle.includes(candidate));
    if (match?.[1]) return match[1];
  }
  return "";
}

function inferIntent(text: string): { intent: string; leadRole: string } {
  const lowered = text.toLowerCase();
  if (/\b(sell|seller|home value|valuation|worth|list my)\b/i.test(lowered)) return { intent: "seller_valuation", leadRole: "seller" };
  if (/\b(rent|lease)\b/i.test(lowered)) return { intent: "rental_search", leadRole: "renter" };
  return { intent: "buyer_search", leadRole: "buyer" };
}

function extractBudget(text: string): string {
  const match = text.match(/(?:under|below|up to|max|maximum|budget|price|around)\s*\$?\s*(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?\b|\$\s*(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?\b/i);
  if (!match) return "";
  const rawText = match[1] || match[3] || "";
  const suffix = (match[2] || match[4] || "").toLowerCase();
  const raw = Number(rawText);
  if (!Number.isFinite(raw)) return "";
  const value = suffix.startsWith("m") ? raw * 1_000_000 : suffix.startsWith("k") || raw < 10_000 ? raw * 1_000 : raw;
  return String(Math.round(value));
}

function extractBedrooms(text: string): string {
  return text.match(/\b(\d+)\s*(?:bed|bd|bedroom)s?\b/i)?.[1] || "";
}

function extractBathrooms(text: string): string {
  return text.match(/\b(\d+(?:\.\d+)?)\s*(?:bath|ba|bathroom)s?\b/i)?.[1] || "";
}

function extractTimeline(text: string): string {
  const match = text.match(/\b(?:asap|today|tomorrow|this week|weekend|next week|\d+\s*(?:day|week|month)s?|\d+\s*[-–]\s*\d+\s*(?:day|week|month)s?)\b/i);
  return match?.[0] || "";
}

function extractArea(fields: Record<string, string>, text: string): string {
  const direct = valueByKey(fields, ["area", "city", "neighborhood", "location", "where_are_you_looking", "preferred_area", "zip_code"]);
  if (direct) return direct;
  const inMatch = text.match(/\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})(?:[,.]|$)/);
  return inMatch?.[1] || "";
}

function firstLastName(fields: Record<string, string>): string {
  const full = valueByKey(fields, ["full_name", "name"]);
  if (full) return full;
  return [fields.first_name, fields.last_name].filter(Boolean).join(" ");
}

export function normalizeMetaLeadgenLead(lead: MetaLeadgenLead): MetaLeadgenNormalized {
  const fields: Record<string, string> = {};
  for (const field of lead.field_data || []) fields[normalizedKey(field.name)] = fieldValue(field);
  const allFieldText = Object.entries(fields)
    .filter(([key]) => !NAME_KEYS.has(key) && !EMAIL_KEYS.has(key) && !PHONE_KEYS.has(key))
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const message = valueByKey(fields, ["message", "question", "what_are_you_looking_for", "comments", "notes", "property_interest"]) || allFieldText;
  const { intent, leadRole } = inferIntent(`${message} ${lead.form_id || ""} ${lead.ad_name || ""} ${lead.campaign_name || ""}`);
  const preferredChannel = inferPreferredChannelFromText(message, normalizePhone(valueByKey(fields, ["phone", "phone_number", "mobile"])) ? "sms" : "email");
  const smsConsent = /\b(?:sms|text)\b/i.test(message) || preferredChannel === "sms" ? "lead_form" : "";
  const callConsent = /\b(?:call|phone)\b/i.test(message) ? "lead_form" : "";
  const whatsappConsent = /\bwhatsapp\b/i.test(message) ? "lead_form" : "";
  const budget = valueByKey(fields, ["budget", "price_range", "max_price"]) || extractBudget(message);
  const bedrooms = valueByKey(fields, ["bedrooms", "beds"]) || extractBedrooms(message);
  const bathrooms = valueByKey(fields, ["bathrooms", "baths"]) || extractBathrooms(message);
  const area = extractArea(fields, message);
  const timeline = valueByKey(fields, ["timeline", "timeframe", "when_are_you_looking_to_move"]) || extractTimeline(message);
  const propertyInterest = valueByKey(fields, ["property", "property_interest", "address", "listing"]);
  const sourceDetail = [lead.campaign_name, lead.ad_name, lead.form_id ? `form ${lead.form_id}` : ""].filter(Boolean).join("; ");
  const summary = [
    `Facebook lead form: ${firstLastName(fields) || valueByKey(fields, ["email"]) || valueByKey(fields, ["phone_number"]) || lead.id}`,
    message ? `Message: ${message}` : "",
    budget ? `Budget: ${budget}` : "",
    area ? `Area: ${area}` : "",
    bedrooms ? `Beds: ${bedrooms}` : "",
    timeline ? `Timeline: ${timeline}` : "",
  ].filter(Boolean).join("\n");

  return {
    leadId: lead.id,
    fullName: firstLastName(fields),
    email: valueByKey(fields, ["email", "email_address"]).toLowerCase(),
    phone: normalizePhone(valueByKey(fields, ["phone", "phone_number", "mobile", "mobile_phone"])),
    message,
    preferredChannel,
    smsConsent,
    callConsent,
    whatsappConsent,
    intent,
    leadRole,
    budget,
    area,
    bedrooms,
    bathrooms,
    timeline,
    propertyInterest,
    summary,
    sourceDetail,
    providerMetadata: {
      provider: "meta_lead_ads",
      leadId: lead.id,
      formId: lead.form_id || "",
      adId: lead.ad_id || "",
      adName: lead.ad_name || "",
      adsetId: lead.adset_id || "",
      adsetName: lead.adset_name || "",
      campaignId: lead.campaign_id || "",
      campaignName: lead.campaign_name || "",
      platform: lead.platform || "facebook",
      fields,
    },
  };
}

export function metaLeadgenIngestInput(lead: MetaLeadgenLead): ChannelIngestInput {
  const normalized = normalizeMetaLeadgenLead(lead);
  return {
    channel: "sms",
    direction: "inbound",
    eventAt: lead.created_time || new Date().toISOString(),
    agentName: IRIS_AGENT_NAME,
    email: normalized.email,
    phone: normalized.phone,
    fullName: normalized.fullName,
    source: "facebook_lead_ad",
    sourceDetail: normalized.sourceDetail,
    threadRef: normalized.phone ? `sms:${normalized.phone}` : normalized.email ? `email:${normalized.email}` : `meta_leadgen:${normalized.leadId}`,
    eventType: "facebook_lead_form_submitted",
    messageText: normalized.message,
    summary: normalized.summary,
    preferredChannel: normalized.preferredChannel,
    smsConsent: normalized.smsConsent,
    callConsent: normalized.callConsent,
    leadRole: normalized.leadRole,
    intent: normalized.intent,
    propertyInterest: normalized.propertyInterest,
    nextAction: "speed_to_lead_followup",
    status: "received",
    providerMessageId: normalized.leadId,
    providerThreadId: lead.form_id || "",
    providerMetadata: normalized.providerMetadata,
  };
}

export function initialLeadgenReply(lead: MetaLeadgenNormalized): string {
  const name = lead.fullName.split(/\s+/)[0] || "there";
  if (lead.leadRole === "seller") {
    const subject = lead.propertyInterest || lead.area || "your home";
    return `Hey ${name}, this is Austin Realty. I saw your request about ${subject}. I can help with a quick value range and what would move the number up or down. Is this the best number to text?`;
  }
  const specs = [lead.bedrooms ? `${lead.bedrooms}-bed` : "", lead.budget ? `under $${Number(lead.budget).toLocaleString()}` : "", lead.area ? `in ${lead.area}` : ""]
    .filter(Boolean)
    .join(" ");
  return `Hey ${name}, this is Austin Realty. I saw your request${specs ? ` for ${specs}` : ""}. I can send matching homes now. Any must-haves like yard, garage, schools, or move-in timing?`;
}

export async function fetchMetaLeadgenLead(leadgenId: string, accessToken: string, graphVersion = "v20.0"): Promise<MetaLeadgenLead> {
  const version = graphVersion.trim().replace(/^\/+/, "") || "v20.0";
  const fields = [
    "id",
    "created_time",
    "ad_id",
    "ad_name",
    "adset_id",
    "adset_name",
    "campaign_id",
    "campaign_name",
    "form_id",
    "platform",
    "field_data",
  ].join(",");
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Meta lead lookup failed: ${response.status}`);
  return await response.json() as MetaLeadgenLead;
}

export function extractLeadgenIds(payload: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = Array.isArray((entry as Record<string, unknown>).changes) ? (entry as Record<string, unknown>).changes as unknown[] : [];
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = (change as Record<string, unknown>).value;
      if (value && typeof value === "object") {
        const leadgenId = clean((value as Record<string, unknown>).leadgen_id || (value as Record<string, unknown>).leadgenId);
        if (leadgenId) ids.add(leadgenId);
      }
    }
  }
  const direct = clean(payload.leadgen_id || payload.leadgenId || payload.id);
  if (direct) ids.add(direct);
  return [...ids];
}
