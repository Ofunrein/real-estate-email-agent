// Create or update Aria's Vapi assistant from lib/ariaAssistant.ts (config-as-code).
// Run: npm run aria:provision            (create or update)
//      npm run aria:provision -- --dry-run   (print the assistant JSON only)
//
// Env: VAPI_API_KEY (required), VAPI_ASSISTANT_ID (update if set, else create),
//      PUBLIC_BASE_URL or VERCEL_URL (tool/server webhook base), CHANNEL_WEBHOOK_SECRET.
import fs from "node:fs";
import { resolveClientConfig } from "../lib/clientConfig.ts";
import { buildAriaAssistant } from "../lib/ariaAssistant.ts";
import { fetchStyleContext } from "../lib/styleTraining.ts";

const VAPI_BASE = "https://api.vapi.ai";

function loadEnv(path = ".env") {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}

loadEnv();

function ariaToolUrl(publicUrl, secret, name) {
  const url = new URL(`/api/webhooks/aria-tools/${name}`, publicUrl);
  if (secret) url.searchParams.set("secret", secret);
  return url.toString();
}

function buildVapiPlatformTools(publicUrl, secret) {
  return [
    {
      type: "function",
      function: {
        name: "getCallerContext",
        description: "Load the caller's omnichannel lead memory and recent conversation history across Theo SMS, Iris email, Olivia chat, Aria voice, and website/social channels. Use once at the start of every call before greeting with prior context or asking follow-up questions.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "getCallerContext") },
    },
    {
      type: "function",
      function: {
        name: "searchProperties",
        description: "Search live available property rows from the Lumenosis/Aria Neon property database by natural-language criteria during a call. Use for availability, options, similar homes, area, budget, beds, baths, property type, or keyword requests before answering.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The caller's exact natural-language request, e.g. 'what homes do you have available in Austin under 500k'.",
            },
            area: {
              type: "string",
              description: "City, neighborhood, ZIP, or area if the caller mentioned one.",
            },
            beds: {
              type: "number",
              description: "Minimum bedrooms requested.",
            },
            baths: {
              type: "number",
              description: "Minimum bathrooms requested.",
            },
            minPrice: {
              type: "number",
              description: "Minimum price if requested.",
            },
            maxPrice: {
              type: "number",
              description: "Maximum price or budget if requested.",
            },
          },
          required: ["query"],
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "searchProperties") },
    },
    {
      type: "function",
      function: {
        name: "lookupProperty",
        description: "Look up confirmed details for one specific property/address during a call. Use before answering questions about price, beds, baths, sqft, neighborhood, or listing details for a named address.",
        parameters: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "Full or partial property address the caller asked about.",
            },
            query: {
              type: "string",
              description: "Fallback caller wording if the address is incomplete or uncertain.",
            },
            message: {
              type: "string",
              description: "The caller's original question about the property.",
            },
          },
          required: ["address"],
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "lookupProperty") },
    },
    {
      type: "function",
      function: {
        name: "sendPropertyDetailsSms",
        description: "Send property listing details, links, and available listing photos by SMS/MMS through Theo/Twilio during a call. Use immediately when the caller asks for photos/details/links or agrees to receive them.",
        parameters: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "Specific property address to send, if one was selected or mentioned.",
            },
            query: {
              type: "string",
              description: "Caller wording or search criteria if no exact address was selected.",
            },
            area: {
              type: "string",
              description: "City, neighborhood, ZIP, or area if the caller mentioned one.",
            },
            beds: {
              type: "number",
              description: "Minimum bedrooms requested.",
            },
            baths: {
              type: "number",
              description: "Minimum bathrooms requested.",
            },
            minPrice: {
              type: "number",
              description: "Minimum price if requested.",
            },
            maxPrice: {
              type: "number",
              description: "Maximum price or budget if requested.",
            },
            includePhotos: {
              type: "boolean",
              description: "Whether to include available listing photo media. Default true.",
            },
          },
          required: ["query"],
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "sendPropertyDetailsSms") },
    },
    {
      type: "function",
      function: {
        name: "checkAvailability",
        description: "Find available consultation slots from Iris' server-side calendar for a requested date, date range, or time of day. Use before offering a specific appointment time.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Requested date as YYYY-MM-DD when known, or words like today/tomorrow if that is all the caller gave.",
            },
            timeOfDay: {
              type: "string",
              enum: ["morning", "afternoon", "evening"],
              description: "Requested daypart if the caller gave one.",
            },
            from: {
              type: "string",
              description: "Optional ISO start datetime for a custom availability window.",
            },
            to: {
              type: "string",
              description: "Optional ISO end datetime for a custom availability window.",
            },
            durationMinutes: {
              type: "number",
              description: "Appointment duration in minutes. Default 30.",
            },
          },
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "checkAvailability") },
    },
    {
      type: "function",
      function: {
        name: "bookConsultation",
        description: "Book a real estate consultation through Iris' server-side appointment stack after the caller confirms a specific slot.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Confirmed appointment date as YYYY-MM-DD.",
            },
            time: {
              type: "string",
              description: "Confirmed local appointment time, e.g. 2:30 PM.",
            },
            appointmentTime: {
              type: "string",
              description: "Optional combined date/time when Vapi parsed the slot as one value.",
            },
            callerName: {
              type: "string",
              description: "Confirmed caller name.",
            },
            callerPhone: {
              type: "string",
              description: "Confirmed best phone number.",
            },
            callerEmail: {
              type: "string",
              description: "Confirmed email address.",
            },
            propertyAddress: {
              type: "string",
              description: "Property address or context for the consultation.",
            },
            notes: {
              type: "string",
              description: "Brief appointment context for the agent.",
            },
          },
          required: ["date", "time"],
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "bookConsultation") },
    },
    {
      type: "function",
      function: {
        name: "qualifyLead",
        description: "Save lead qualification fields to the omnichannel brain mid-call. Call as soon as the caller provides any field: name, role, budget, timeline, area, beds/baths, property interest, or contact/SMS consent. Do not wait until call end.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Caller's full name as confirmed." },
            email: { type: "string", description: "Caller's email if provided." },
            role: { type: "string", enum: ["buyer", "seller", "renter", "investor", "agent", "unknown"], description: "Lead role." },
            budget: { type: "string", description: "Budget range or max price, e.g. '$500k' or '$400k-$600k'." },
            timeline: { type: "string", description: "How soon they want to act, e.g. '1-2 months', 'ASAP', 'end of year'." },
            area: { type: "string", description: "Preferred neighborhood, city, or ZIP." },
            bedrooms: { type: "number", description: "Minimum bedrooms needed." },
            bathrooms: { type: "number", description: "Minimum bathrooms needed." },
            property: { type: "string", description: "Specific address or property they mentioned." },
            preferred_channel: { type: "string", enum: ["sms", "email", "phone", "any"], description: "How they prefer to be contacted." },
            call_consent: { type: "string", enum: ["yes", "no"], description: "Consents to receive calls." },
            sms_consent: { type: "string", enum: ["yes", "no"], description: "Consents to receive SMS." },
          },
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "qualifyLead") },
    },
    {
      type: "function",
      function: {
        name: "scheduleShowing",
        description: "Book a property showing when the caller wants to view a specific home. Use after confirming address, date, time, and caller contact details.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["book", "cancel", "reschedule"], description: "What to do with the showing. Default 'book'." },
            address: { type: "string", description: "Property address for the showing." },
            startTime: { type: "string", description: "ISO datetime for the showing start." },
            newStartTime: { type: "string", description: "New ISO datetime when rescheduling." },
            callerName: { type: "string", description: "Confirmed caller name." },
            callerPhone: { type: "string", description: "Confirmed caller phone." },
            callerEmail: { type: "string", description: "Confirmed caller email." },
            notes: { type: "string", description: "Any notes for the agent." },
          },
          required: ["address"],
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "scheduleShowing") },
    },
    {
      type: "function",
      function: {
        name: "cancelAppointment",
        description: "Cancel the caller's existing upcoming appointment. Use when the caller explicitly asks to cancel a consultation or showing.",
        parameters: {
          type: "object",
          properties: {
            appointmentId: { type: "string", description: "Appointment ID if known." },
            reason: { type: "string", description: "Brief reason for cancellation." },
          },
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "cancelAppointment") },
    },
    {
      type: "function",
      function: {
        name: "rescheduleAppointment",
        description: "Reschedule the caller's existing appointment to a new date and time. Confirm the new slot before calling.",
        parameters: {
          type: "object",
          properties: {
            new_date: { type: "string", description: "New appointment date as YYYY-MM-DD." },
            new_time: { type: "string", description: "New appointment time, e.g. '3:00 PM'." },
            appointmentId: { type: "string", description: "Appointment ID if known." },
          },
          required: ["new_date", "new_time"],
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "rescheduleAppointment") },
    },
    {
      type: "function",
      function: {
        name: "syncToCrm",
        description: "Write the caller's contact and call context to the CRM after the call is complete or before transfer. Use when transferring to a human or at call end when no booking was made.",
        parameters: {
          type: "object",
          properties: {
            callerName: { type: "string", description: "Confirmed caller name." },
            callerEmail: { type: "string", description: "Caller email if given." },
            note: { type: "string", description: "Brief call summary for the CRM activity log." },
            outcome: { type: "string", enum: ["QUALIFIED", "TRANSFERRED", "VOICEMAIL", "NOT_INTERESTED", "FOLLOW_UP"], description: "Call disposition." },
          },
        },
      },
      server: { url: ariaToolUrl(publicUrl, secret, "syncToCrm") },
    },
    {
      type: "slack.message.send",
      function: {
        name: "notifySlackLeadIssue",
        description: "Send a Slack notification when a caller has a complaint, lead issue, urgent handoff, or booking confirmation.",
        parameters: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Slack notification text, e.g. Booking confirmed or Lead issue with caller details.",
            },
          },
          required: ["message"],
        },
      },
    },
    {
      type: "code",
      function: {
        name: "sendBookingSmsConfirmation",
        description: "Send a booking confirmation SMS to the caller and an agent booking alert SMS through Twilio. Use immediately after bookConsultation succeeds.",
        parameters: {
          type: "object",
          properties: {
            callerPhone: {
              type: "string",
              description: "Caller phone number in E.164 format when available.",
            },
            callerName: {
              type: "string",
              description: "Caller name.",
            },
            appointmentTime: {
              type: "string",
              description: "Confirmed appointment date/time in caller-friendly local time.",
            },
            appointmentType: {
              type: "string",
              description: "consultation, showing, valuation, or follow-up.",
            },
            propertyAddress: {
              type: "string",
              description: "Property address if discussed.",
            },
            summary: {
              type: "string",
              description: "One-line booking context for the agent.",
            },
          },
          required: ["appointmentTime"],
        },
      },
      timeoutSeconds: 30,
      code: `
const twilioSid = env.TWILIO_ACCOUNT_SID;
const twilioToken = env.TWILIO_AUTH_TOKEN;
const twilioFrom = env.TWILIO_FROM;
const agentPhone = env.ARIA_AGENT_CONFIRMATION_PHONE || "+15128115302";

function cleanPhone(value) {
  const raw = String(value || "").replace(/^(?:sms|rcs):/i, "").trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return raw;
}

function unsafeRecipient(value) {
  const digits = cleanPhone(value).replace(/\\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 15) return true;
  if (/^0+$/.test(digits)) return true;
  if (digits.length === 11 && digits.startsWith("1") && digits.slice(4, 7) === "555") return true;
  if (digits.length === 10 && digits.slice(3, 6) === "555") return true;
  return false;
}

async function sendSms(to, body) {
  const recipient = cleanPhone(to);
  if (!twilioSid || !twilioToken || !twilioFrom) return { sent: false, skipped: true, error: "twilio_not_configured" };
  if (!recipient || !body) return { sent: false, skipped: true, error: "missing_recipient_or_body" };
  if (unsafeRecipient(recipient)) return { sent: false, skipped: true, error: "unsafe_recipient" };

  const url = \`https://api.twilio.com/2010-04-01/Accounts/\${encodeURIComponent(twilioSid)}/Messages.json\`;
  const form = new URLSearchParams({ To: recipient, From: twilioFrom, Body: body.slice(0, 1500) });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: \`Basic \${Buffer.from(\`\${twilioSid}:\${twilioToken}\`).toString("base64")}\`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  return {
    sent: response.ok,
    skipped: false,
    status: response.status,
    sid: payload.sid || "",
    error: response.ok ? "" : String(payload.message || response.statusText || "twilio_send_failed"),
  };
}

const callerName = args.callerName || "there";
const appointmentType = args.appointmentType || "consultation";
const propertyLine = args.propertyAddress ? \`\\nProperty: \${args.propertyAddress}\` : "";
const callerBody = [
  \`Confirmed: your \${appointmentType} is set for \${args.appointmentTime}.\`,
  args.propertyAddress ? \`Property: \${args.propertyAddress}\` : "",
  "Reply here with questions.",
].filter(Boolean).join("\\n");
const agentBody = [
  "Aria booking confirmed",
  \`Lead: \${callerName}\`,
  args.callerPhone ? \`Phone: \${cleanPhone(args.callerPhone)}\` : "",
  \`When: \${args.appointmentTime}\`,
  \`Type: \${appointmentType}\`,
  args.propertyAddress ? \`Property: \${args.propertyAddress}\` : "",
  args.summary ? \`Summary: \${args.summary}\` : "",
].filter(Boolean).join("\\n");

const callerSms = args.callerPhone ? await sendSms(args.callerPhone, callerBody) : { sent: false, skipped: true, error: "missing_caller_phone" };
const agentSms = await sendSms(agentPhone, agentBody);

return { ok: Boolean(callerSms.sent || agentSms.sent), callerSms, agentSms };
`.trim(),
      environmentVariables: [
        { name: "TWILIO_ACCOUNT_SID", value: process.env.TWILIO_ACCOUNT_SID || "" },
        { name: "TWILIO_AUTH_TOKEN", value: process.env.TWILIO_AUTH_TOKEN || "" },
        { name: "TWILIO_FROM", value: process.env.TWILIO_FROM || "" },
        { name: "ARIA_AGENT_CONFIRMATION_PHONE", value: process.env.ARIA_AGENT_CONFIRMATION_PHONE || "+15128115302" },
      ],
    },
  ];
}

function publicBaseUrl() {
  const explicit = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL || "";
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "";
}

async function vapiRequest(path, apiKey, init = {}) {
  const response = await fetch(`${VAPI_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Vapi ${init.method || "GET"} ${path} failed (${response.status}): ${JSON.stringify(payload, null, 2)}`);
  }
  return payload;
}

async function upsertTool(apiKey, existingByName, tool) {
  const name = tool.function?.name;
  if (!name) throw new Error(`Vapi tool is missing function.name: ${JSON.stringify(tool)}`);

  const existing = existingByName.get(name);
  if (existing?.id) {
    const { type: _type, ...patchableTool } = tool;
    await vapiRequest(`/tool/${existing.id}`, apiKey, {
      method: "PATCH",
      body: JSON.stringify(patchableTool),
    });
    return { id: existing.id, name, action: "updated" };
  }

  const created = await vapiRequest("/tool", apiKey, {
    method: "POST",
    body: JSON.stringify(tool),
  });
  return { id: created.id, name, action: "created" };
}

async function attachReusableTools(apiKey, assistant, publicUrl, secret) {
  const model = assistant.model || {};
  const inlineTools = model.tools || [];
  const nativeInlineTools = inlineTools.filter((tool) => tool.type !== "function");
  const platformTools = buildVapiPlatformTools(publicUrl, secret);

  const allTools = await vapiRequest("/tool", apiKey);
  const existingTools = Array.isArray(allTools) ? allTools : allTools.data || [];
  const existingByName = new Map();
  for (const tool of existingTools) {
    const name = tool.function?.name || tool.name;
    if (name && !existingByName.has(name)) existingByName.set(name, tool);
  }

  const syncedTools = [];
  for (const tool of platformTools) {
    syncedTools.push(await upsertTool(apiKey, existingByName, tool));
  }

  return {
    assistant: {
      ...assistant,
      model: {
        ...model,
        tools: nativeInlineTools,
        toolIds: syncedTools.map((tool) => tool.id),
      },
    },
    syncedTools,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const apiKey = process.env.VAPI_API_KEY || "";
  const assistantId = process.env.VAPI_ASSISTANT_ID || "";
  const publicUrl = publicBaseUrl();
  const secret = process.env.CHANNEL_WEBHOOK_SECRET || "";

  const config = resolveClientConfig(process.env);
  if (!config.humanTransferNumber) {
    console.error("Set HUMAN_TRANSFER_NUMBER (live transfer destination) before provisioning.");
    process.exit(1);
  }

  let assistant = buildAriaAssistant(config, { publicUrl: publicUrl || "https://vapi.local", secret, styleContext: await fetchStyleContext().catch(() => "") });

  if (dryRun) {
    console.log(JSON.stringify(assistant, null, 2));
    return;
  }

  if (!apiKey) {
    console.error("VAPI_API_KEY is required to provision the assistant. Use --dry-run to preview.");
    process.exit(1);
  }
  if (!publicUrl) {
    console.error("PUBLIC_BASE_URL or VERCEL_URL is required so Vapi can call searchProperties and lookupProperty during calls.");
    process.exit(1);
  }

  const { assistant: assistantWithToolIds, syncedTools } = await attachReusableTools(apiKey, assistant, publicUrl, secret);
  assistant = assistantWithToolIds;

  const url = assistantId ? `${VAPI_BASE}/assistant/${assistantId}` : `${VAPI_BASE}/assistant`;
  const method = assistantId ? "PATCH" : "POST";
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(assistant),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Vapi ${method} failed (${response.status}):`, JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  const id = payload.id || assistantId;
  console.log(`${assistantId ? "Updated" : "Created"} Aria assistant: ${id}`);
  console.log(`Attached Vapi platform tools: ${syncedTools.map((tool) => `${tool.name}:${tool.id}`).join(", ")}`);
  if (!assistantId) {
    console.log(`Set VAPI_ASSISTANT_ID=${id} and bind a Vapi phone number to this assistant.`);
  }
  console.log(`Transfer destination: ${config.humanTransferNumber}`);
  console.log("Tool host: Vapi call controls plus Aria property/calendar webhook tools.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
