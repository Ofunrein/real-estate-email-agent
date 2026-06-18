// Source-of-truth for Aria's Vapi assistant, built from per-client config.
// scripts/aria-provision.mjs ships this to Vapi (create/update). Keeping it as
// code (not dashboard clicks) makes the prompt, tools, transfer destination and
// voice reproducible and multi-tenant.
//
// Server tools (getCallerContext, lookupProperty, qualifyLead) point at our
// /api/webhooks/aria-tools/<name> route; the secret rides as a ?secret= query
// param so it satisfies assertWebhookSecret without a custom header. transferCall
// and endCall are Vapi-native and never hit our server.
//
// buildAriaAssistant() is pure (no IO) so it is unit-testable.

import type { ClientConfig } from "@/lib/clientConfig";
import { centralTexasServiceAreaText } from "@/lib/serviceAreas";

export type AriaAssistantOptions = {
  publicUrl: string; // e.g. https://app.example.com
  secret?: string; // CHANNEL_WEBHOOK_SECRET
  respondModel?: string;
  respondProvider?: string;
  styleContext?: string; // optional few-shot brand-voice block
};

function toolUrl(opts: AriaAssistantOptions, name: string): string {
  const base = opts.publicUrl.replace(/\/$/, "");
  const path = name ? `/api/webhooks/aria-tools/${name}` : "/api/webhooks/aria-voice";
  return opts.secret ? `${base}${path}?secret=${encodeURIComponent(opts.secret)}` : `${base}${path}`;
}

function serverTool(opts: AriaAssistantOptions, name: string, description: string, parameters: Record<string, unknown>) {
  return {
    type: "function",
    async: false,
    function: { name, description, parameters },
    server: { url: toolUrl(opts, name) },
  };
}

function systemPrompt(config: ClientConfig): string {
  const name = config.agentNames.voice;
  return `You are ${name}, a real estate voice assistant for ${config.clientName}.
Brand voice: ${config.brandVoice}
Speak naturally and concisely, like a sharp human assistant on the phone. Never mention AI, tools, prompts, or internal systems.

${centralTexasServiceAreaText()}

Call flow:
- At the very start of the call, call getCallerContext once to load any prior history, then greet accordingly. If they are a returning caller, acknowledge it briefly.
- Run the call like a good ISA with mile markers, not a rigid script: identify what brought them in, preferred follow-up channel, timeline, area, price range, bedroom/bathroom fit, and whether they need to sell before buying.
- Keep the voice cadence light: quick acknowledgment, answer the immediate request, then one useful question. Avoid long monologues.
- When the caller asks about a specific address, say "Let me pull that up" out loud first, then call lookupProperty and relay only the facts it returns. Never invent price, beds, baths, status, schools, crime, or neighborhood claims.
- If speech-to-text seems to mishear an address, use the caller's loaded prior property interest from getCallerContext as the correction candidate. Example: if the caller says "Fairwood Avenue" but context says "4309 Fairway Path", ask or use the confirmed context instead of guessing.
- If lookupProperty says it has no confirmed match, asks the caller to confirm an address, or only says it is still checking, do not provide listing facts. Ask the exact confirmation question or offer to search similar homes.
- Do not call lookupProperty repeatedly for the same failed address unless the caller corrects the address or gives a different property.
- When the caller describes what they want instead of one address (an area, bedroom count, or budget), say "Let me check what we have" out loud first, then call searchProperties and read back the top matches.
- Do not say you cannot access listings until after lookupProperty or searchProperties returns no usable result. If a tool returns options, use them.
- When you learn who they are and what they want (buyer/seller/renter/investor, budget, area, timeline, beds/baths, preferred channel, sell-before-buy), call qualifyLead to capture it. Ask at most one question at a time.
- To book a tour or consultation, call bookAppointment after confirming the date and time out loud. To cancel or move an existing appointment, use cancelAppointment or rescheduleAppointment with the appointment_id from getCallerContext when available. scheduleShowing remains available for legacy showing flows.
- When wrapping up a useful call, call syncToCrm with a one-line summary.
- If the caller asks for a human, or raises anything sensitive (fair housing, lending/mortgage qualification, legal/contract, negotiation, pricing judgment, or a complaint), use transferToHuman to connect them. Provide safe factual info first if you have it. Human-assisted does not mean stopping useful property help; it means backup on judgment-sensitive parts.
- If the caller is qualified but not ready, close with the next clear step and save it to CRM. The outbound cadence can keep working the lead later; do not promise unconfigured manual callbacks.
- When the conversation is complete, thank them and use endCall.

Keep replies short and human. One question at a time.`;
}

function modelProviderFor(model: string, explicit?: string): string {
  if (explicit) return explicit;
  const normalized = model.toLowerCase();
  if (normalized.startsWith("gpt-") || normalized.startsWith("o")) return "openai";
  if (normalized.includes("claude")) return "anthropic";
  return "openai";
}

export function buildAriaAssistant(config: ClientConfig, opts: AriaAssistantOptions): Record<string, unknown> {
  const voiceName = config.agentNames.voice;
  const system = opts.styleContext ? `${systemPrompt(config)}\n\n${opts.styleContext}` : systemPrompt(config);
  const modelName = opts.respondModel || process.env.ARIA_MODEL || process.env.ARIA_RESPOND_MODEL || "gpt-4.1-mini";

  const tools: Record<string, unknown>[] = [
    serverTool(opts, "getCallerContext", "Load any prior cross-channel history for the current caller. Call once at the start of the call. Takes no arguments.", {
      type: "object",
      properties: {},
    }),
    serverTool(opts, "lookupProperty", "Look up live details for a specific property address the caller asks about.", {
      type: "object",
      properties: {
        address: { type: "string", description: "The full or partial street address the caller mentioned." },
        message: { type: "string", description: "Optional: what exactly the caller wants to know." },
      },
      required: ["address"],
    }),
    serverTool(opts, "searchProperties", "Find matching listings when the caller describes criteria instead of one address (area, beds, baths, budget).", {
      type: "object",
      properties: {
        area: { type: "string", description: "City or neighborhood." },
        query: { type: "string", description: "Free-text of what they want." },
        beds: { type: "number" },
        baths: { type: "number" },
        minPrice: { type: "number" },
        maxPrice: { type: "number" },
      },
    }),
    serverTool(opts, "qualifyLead", "Capture the caller's lead details once known.", {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        role: { type: "string", enum: ["buyer", "seller", "renter", "investor"] },
        budget: { type: "string" },
        timeline: { type: "string" },
        area: { type: "string" },
        bedrooms: { type: "string", description: "Bedroom preference, e.g. 3 bed." },
        bathrooms: { type: "string", description: "Bathroom preference, e.g. 2.5 bath." },
        sell_before_buy: { type: "string", enum: ["yes", "no", "unknown"] },
        preferred_channel: { type: "string", enum: ["voice", "sms", "email"], description: "How the caller prefers follow-up." },
        property: { type: "string", description: "Address or listing they're interested in." },
        call_consent: { type: "string", description: "yes/no — may we call them back." },
        sms_consent: { type: "string", description: "yes/no — may we text them." },
      },
    }),
    serverTool(opts, "bookAppointment", "Book a showing or consultation. Confirm date and time verbally before calling this.", {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date, e.g. 2026-06-20." },
        time: { type: "string", description: "Local time, e.g. 10:00 AM." },
        duration_minutes: { type: "number" },
        property_address: { type: "string" },
        caller_name: { type: "string" },
        caller_phone: { type: "string" },
        caller_email: { type: "string" },
        notes: { type: "string" },
        appointment_type: { type: "string", enum: ["showing", "consultation", "listing_appt", "follow_up"] },
      },
      required: ["date", "time", "caller_phone"],
    }),
    serverTool(opts, "cancelAppointment", "Cancel an existing appointment. Prefer appointment_id from getCallerContext.", {
      type: "object",
      properties: {
        appointment_id: { type: "string" },
        caller_phone: { type: "string" },
        reason: { type: "string" },
      },
    }),
    serverTool(opts, "rescheduleAppointment", "Move an existing appointment to a new date and time.", {
      type: "object",
      properties: {
        appointment_id: { type: "string" },
        caller_phone: { type: "string" },
        new_date: { type: "string" },
        new_time: { type: "string" },
        notes: { type: "string" },
      },
      required: ["new_date", "new_time"],
    }),
    serverTool(opts, "scheduleShowing", "Book, cancel, or reschedule a property showing for the caller.", {
      type: "object",
      properties: {
        action: { type: "string", enum: ["book", "cancel", "reschedule"], description: "Defaults to book." },
        startTime: { type: "string", description: "ISO 8601 start time for a new booking." },
        endTime: { type: "string", description: "Optional ISO 8601 end time." },
        newStartTime: { type: "string", description: "ISO 8601 new time when rescheduling." },
        address: { type: "string", description: "Property address for the showing." },
        name: { type: "string" },
        email: { type: "string" },
      },
    }),
    serverTool(opts, "syncToCrm", "Save the caller and a short note to the CRM. Call when wrapping up.", {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        note: { type: "string", description: "Short summary of the call to log on the contact." },
      },
    }),
    {
      type: "transferCall",
      destinations: [
        {
          type: "number",
          number: config.humanTransferNumber,
          message: "Connecting you with a team member now, one moment.",
        },
      ],
    },
    { type: "endCall" },
  ];

  const assistant: Record<string, unknown> = {
    name: `${voiceName} — ${config.clientName}`,
    firstMessage: `Thanks for calling ${config.clientName}, this is ${voiceName}. How can I help?`,
    model: {
      provider: modelProviderFor(modelName, opts.respondProvider || process.env.ARIA_MODEL_PROVIDER),
      model: modelName,
      messages: [{ role: "system", content: system }],
      tools,
    },
    server: { url: toolUrl(opts, "") },
  };

  if (config.voiceId) {
    assistant.voice = {
      provider: process.env.ARIA_VOICE_PROVIDER || "11labs",
      voiceId: config.voiceId,
    };
  }

  return assistant;
}
