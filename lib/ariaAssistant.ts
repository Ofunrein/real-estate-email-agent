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

export type AriaAssistantOptions = {
  publicUrl: string; // e.g. https://app.example.com
  secret?: string; // CHANNEL_WEBHOOK_SECRET
  respondModel?: string;
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

Call flow:
- At the very start of the call, call getCallerContext once to load any prior history, then greet accordingly. If they are a returning caller, acknowledge it briefly.
- When the caller asks about a specific address, call lookupProperty with that address and relay only the facts it returns. Never invent price, beds, baths, status, schools, crime, or neighborhood claims.
- When the caller describes what they want instead of one address (an area, bedroom count, or budget), call searchProperties and read back the top matches.
- When you learn who they are and what they want (buyer/seller/renter/investor, budget, area, timeline), call qualifyLead to capture it. Ask at most one question at a time.
- To book, cancel, or move a tour, call scheduleShowing. Confirm the date and time back to the caller before booking. Only schedule for the person on this call.
- When wrapping up a useful call, call syncToCrm with a one-line summary.
- If the caller asks for a human, or raises anything sensitive (fair housing, lending/mortgage qualification, legal/contract, negotiation, pricing judgment, or a complaint), use transferToHuman to connect them. Provide safe factual info first if you have it.
- When the conversation is complete, thank them and use endCall.

Keep replies short and human. One question at a time.`;
}

export function buildAriaAssistant(config: ClientConfig, opts: AriaAssistantOptions): Record<string, unknown> {
  const voiceName = config.agentNames.voice;
  const system = opts.styleContext ? `${systemPrompt(config)}\n\n${opts.styleContext}` : systemPrompt(config);

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
        property: { type: "string", description: "Address or listing they're interested in." },
        call_consent: { type: "string", description: "yes/no — may we call them back." },
        sms_consent: { type: "string", description: "yes/no — may we text them." },
      },
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
      provider: "anthropic",
      model: opts.respondModel || process.env.ARIA_RESPOND_MODEL || "claude-sonnet-4-6",
      messages: [{ role: "system", content: system }],
      tools,
    },
    server: { url: toolUrl(opts, "") },
  };

  if (config.voiceId) {
    assistant.voice = { provider: "11labs", voiceId: config.voiceId };
  }

  return assistant;
}
