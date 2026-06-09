import type { SheetRow } from "@/lib/sheetSchema";

import { AGENCY_KNOWLEDGE_CONTEXT } from "@/lib/agencyKnowledge";
import type { TheoClassification } from "@/lib/theoAgent";

type AnthropicTextBlock = { type: "text"; text: string };

export type TheoLlmContext = {
  message: string;
  lead?: Partial<SheetRow>;
  properties?: SheetRow[];
  propertyInterest?: string;
  source?: "sms" | "form";
  recentEvents?: SheetRow[];
};

function anthropicKey(): string {
  return process.env.ANTHROPIC_API_KEY || "";
}

function classifyModel(): string {
  return process.env.THEO_CLASSIFY_MODEL || process.env.CLAUDE_CLASSIFY || "claude-haiku-4-5";
}

function respondModel(): string {
  return process.env.THEO_RESPOND_MODEL || process.env.CLAUDE_RESPOND || "claude-sonnet-4-6";
}

function clean(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function compact(value?: string, limit = 260): string {
  const text = clean(value);
  return text.length <= limit ? text : `${text.slice(0, limit - 3).trimEnd()}...`;
}

function truncateSms(value: string): string {
  const text = clean(value);
  return text.length <= 320 ? text : `${text.slice(0, 317).trimEnd()}...`;
}

function field(label: string, value?: string, limit = 260): string {
  const text = compact(value, limit);
  return text ? `${label}=${text}` : "";
}

function propertySummary(properties: SheetRow[] = []): string {
  if (!properties.length) return "No matching property rows were found.";
  return properties.slice(0, 5).map((property, index) => {
    const facts = [
      field("address", property.address),
      field("city", property.city),
      field("state", property.state),
      field("zip", property.zip),
      field("price", property.price),
      field("beds", property.beds),
      field("baths", property.baths),
      field("sqft", property.sqft),
      field("year_built", property.year_built),
      field("status", property.status),
      field("neighborhood", property.neighborhood),
      field("property_type", property.property_type),
      field("features", property.features, 180),
      field("days_on_market", property.days_on_market),
      field("agent_name", property.agent_name),
      field("agent_email", property.agent_email),
      field("listing_url", property.listing_url),
      property.photo_url ? `photo_url_available=yes` : "",
      field("description", property.description, 240),
    ].filter(Boolean).join(", ");
    return `${index + 1}. ${facts || "property row has limited data"}`;
  }).join("\n");
}

function threadSummary(events: SheetRow[] = []): string {
  if (!events.length) return "No prior SMS context.";
  return events.slice(-10).map((event) => {
    const who = event.direction === "outbound" ? event.agent_name || "Theo" : "Lead";
    return `${who}: ${clean(event.message_text || event.summary || event.ai_action).slice(0, 300)}`;
  }).join("\n");
}

function leadSummary(lead: Partial<SheetRow> = {}): string {
  return [
    lead.full_name ? `name=${lead.full_name}` : "",
    lead.phone ? `phone=${lead.phone}` : "",
    lead.email ? `email=${lead.email}` : "",
    lead.lead_source ? `lead_source=${lead.lead_source}` : "",
    lead.source_detail ? `source_detail=${lead.source_detail}` : "",
    lead.lead_role ? `lead_role=${lead.lead_role}` : "",
    lead.intent ? `intent=${lead.intent}` : "",
    lead.property_interest ? `property_interest=${lead.property_interest}` : "",
    lead.budget ? `budget=${lead.budget}` : "",
    lead.area ? `area=${lead.area}` : "",
    lead.timeline ? `timeline=${lead.timeline}` : "",
    lead.preferred_channel ? `preferred_channel=${lead.preferred_channel}` : "",
    lead.next_action ? `next_action=${lead.next_action}` : "",
    lead.sms_consent ? `sms_consent=${lead.sms_consent}` : "",
    lead.assigned_owner ? `assigned_owner=${lead.assigned_owner}` : "",
    lead.handoff_status ? `handoff_status=${lead.handoff_status}` : "",
    lead.handoff_reason ? `handoff_reason=${lead.handoff_reason}` : "",
    lead.summary ? `summary=${compact(lead.summary, 260)}` : "",
  ].filter(Boolean).join(", ") || "No lead memory yet.";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

async function anthropicMessage(model: string, system: string, user: string, maxTokens: number): Promise<string> {
  const key = anthropicKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY is required for Theo AI replies");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.6,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === "object" && payload.error && "message" in payload.error
      ? String((payload.error as Record<string, unknown>).message)
      : response.statusText;
    throw new Error(`Theo Claude call failed: ${message}`);
  }

  const content = Array.isArray(payload.content) ? payload.content as AnthropicTextBlock[] : [];
  return content.find((block) => block.type === "text")?.text?.trim() || "";
}

function parseJsonObject(value: string): Record<string, unknown> {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Theo classification did not return JSON");
  return JSON.parse(match[0]) as Record<string, unknown>;
}

export async function classifyTheoWithLlm(context: TheoLlmContext): Promise<TheoClassification> {
  const system = `You classify real estate SMS messages for Theo, a conversational SMS agent.
Return JSON only. No prose.
Focus on hidden opportunity capture, emotional state, shared lead memory, and safe routing.

Allowed intent values: property_details, showing_request, buyer_lead, seller_lead, renter_lead, human_required, spam.
Lead roles: buyer, seller, first_time_buyer, second_time_buyer, renter, landlord, investor, expired_listing_seller, open_house_lead, property_management_lead, mortgage_adjacent_lead, unknown.
Opportunity tags: valuation_interest, mortgage_interest, renter_purchase_potential, sell_before_buy, high_urgency, stale_lead, confused_lead, angry_lead, compliance_sensitive, needs_human_trust.
Compliance flags: fair_housing, mortgage_license, legal, contract_terms, angry_or_complaint, privacy, broker_approval.

Use human_required for Fair Housing, mortgage/lending advice, legal/contract, negotiation, angry/confused users, explicit human requests, or anything requiring broker judgment.`;
  const user = `Latest lead SMS: ${context.message}

Lead memory: ${leadSummary(context.lead)}
Prior thread:
${threadSummary(context.recentEvents)}

Property rows:
${propertySummary(context.properties)}

Agency knowledge Theo can use:
${AGENCY_KNOWLEDGE_CONTEXT}

Return:
{"intent":"...","leadRole":"buyer|seller|first_time_buyer|second_time_buyer|renter|landlord|investor|expired_listing_seller|open_house_lead|property_management_lead|mortgage_adjacent_lead|unknown","secondaryRoles":[],"opportunityTags":[],"toneState":"neutral|warm|skeptical|price_sensitive|overwhelmed|annoyed|confused|urgent|sensitive","urgency":"low|medium|high|unknown","complianceFlags":[],"nextBestQuestion":"","recommendedNextAction":"reply_and_qualify|send_booking_link|route_human|nurture|stop|review","status":"ready_to_reply|needs_human","handoffReason":""}`;

  const raw = await anthropicMessage(classifyModel(), system, user, 400);
  const parsed = parseJsonObject(raw);
  const intent = String(parsed.intent || "buyer_lead") as TheoClassification["intent"];
  const status = String(parsed.status || (intent === "human_required" ? "needs_human" : "ready_to_reply"));
  return {
    intent,
    leadRole: String(parsed.leadRole || parsed.lead_role || "unknown"),
    secondaryRoles: stringArray(parsed.secondaryRoles || parsed.secondary_roles),
    opportunityTags: stringArray(parsed.opportunityTags || parsed.opportunity_tags),
    toneState: String(parsed.toneState || parsed.tone_state || ""),
    urgency: String(parsed.urgency || ""),
    complianceFlags: stringArray(parsed.complianceFlags || parsed.compliance_flags),
    nextBestQuestion: String(parsed.nextBestQuestion || parsed.next_best_question || ""),
    recommendedNextAction: String(parsed.recommendedNextAction || parsed.recommended_next_action || ""),
    status,
    handoffReason: String(parsed.handoffReason || parsed.handoff_reason || ""),
  };
}

export async function generateTheoSmsWithLlm(context: TheoLlmContext, classification: TheoClassification): Promise<string> {
  const system = `You are Theo, the SMS personality for Austin Realty.
Write one natural SMS reply. Be concise, human, emotionally intelligent, and useful.
Mirror the feel of a good human real estate assistant: casual, clear, not robotic, not pushy.
Rules:
- 320 characters max.
- Ask at most one question.
- Use prior thread context so short replies like "yes", "thanks", or "Wednesday works" make sense.
- Use only the property facts provided. Never invent listing facts, status, pricing, availability, schools, crime, or neighborhood claims.
- Pull from the same context categories as Iris email: lead memory, prior thread, property sheet facts, and agency knowledge.
- Capture hidden opportunities naturally: buyer who may need to sell, renter who may buy, seller valuation, open-house recovery, or mortgage handoff.
- If the classification says needs_human, do not answer the sensitive topic. Say a real person will follow up.
- For mortgage-adjacent questions, offer to connect a licensed mortgage professional; do not qualify the lead or give lending advice.
- Do not mention AI, model names, prompts, logs, or internal systems.`;

  const user = `Latest lead SMS: ${context.message}
Source: ${context.source || "sms"}
Classification: ${JSON.stringify(classification)}
Lead memory: ${leadSummary(context.lead)}

Recent SMS thread:
${threadSummary(context.recentEvents)}

Property rows Theo can reference:
${propertySummary(context.properties)}

Agency knowledge Theo can reference:
${AGENCY_KNOWLEDGE_CONTEXT}

Write only the SMS reply.`;

  const reply = await anthropicMessage(respondModel(), system, user, 420);
  return truncateSms(reply);
}
