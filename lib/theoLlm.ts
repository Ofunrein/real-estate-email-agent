import type { SheetRow } from "@/lib/sheetSchema";

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

function truncateSms(value: string): string {
  const text = clean(value);
  return text.length <= 320 ? text : `${text.slice(0, 317).trimEnd()}...`;
}

function propertySummary(properties: SheetRow[] = []): string {
  if (!properties.length) return "No matching property rows were found.";
  return properties.slice(0, 5).map((property, index) => {
    const facts = [
      property.address ? `address=${property.address}` : "",
      property.price ? `price=${property.price}` : "",
      property.beds ? `beds=${property.beds}` : "",
      property.baths ? `baths=${property.baths}` : "",
      property.sqft ? `sqft=${property.sqft}` : "",
      property.status ? `status=${property.status}` : "",
      property.listing_url ? `listing_url=${property.listing_url}` : "",
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
    lead.lead_role ? `lead_role=${lead.lead_role}` : "",
    lead.intent ? `intent=${lead.intent}` : "",
    lead.property_interest ? `property_interest=${lead.property_interest}` : "",
    lead.next_action ? `next_action=${lead.next_action}` : "",
    lead.sms_consent ? `sms_consent=${lead.sms_consent}` : "",
  ].filter(Boolean).join(", ") || "No lead memory yet.";
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
Allowed intent values: property_details, showing_request, buyer_lead, seller_lead, renter_lead, human_required, spam.
Use human_required for Fair Housing, mortgage/lending advice, legal/contract, negotiation, angry/confused users, explicit human requests, or anything requiring broker judgment.`;
  const user = `Latest lead SMS: ${context.message}

Lead memory: ${leadSummary(context.lead)}
Prior thread:
${threadSummary(context.recentEvents)}

Property rows:
${propertySummary(context.properties)}

Return:
{"intent":"...","leadRole":"buyer|seller|renter|investor|unknown","status":"ready_to_reply|needs_human","handoffReason":""}`;

  const raw = await anthropicMessage(classifyModel(), system, user, 400);
  const parsed = parseJsonObject(raw);
  const intent = String(parsed.intent || "buyer_lead") as TheoClassification["intent"];
  const status = String(parsed.status || (intent === "human_required" ? "needs_human" : "ready_to_reply"));
  return {
    intent,
    leadRole: String(parsed.leadRole || parsed.lead_role || "unknown"),
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
- If the classification says needs_human, do not answer the sensitive topic. Say a real person will follow up.
- Do not mention AI, model names, prompts, logs, or internal systems.`;

  const user = `Latest lead SMS: ${context.message}
Source: ${context.source || "sms"}
Classification: ${JSON.stringify(classification)}
Lead memory: ${leadSummary(context.lead)}

Recent SMS thread:
${threadSummary(context.recentEvents)}

Property rows Theo can reference:
${propertySummary(context.properties)}

Write only the SMS reply.`;

  const reply = await anthropicMessage(respondModel(), system, user, 420);
  return truncateSms(reply);
}
