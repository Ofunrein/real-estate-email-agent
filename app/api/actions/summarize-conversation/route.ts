import { NextRequest, NextResponse } from "next/server";

import { buildConversationSummary, customFieldFromConversationSummary } from "@/lib/conversationSummary";
import { databaseEnabled, readEventsForContactIdentityFromDatabase, readEventsForThreadFromDatabase } from "@/lib/database";
import { resolveCrmAdapter } from "@/lib/crm";
import { createRequestAudit } from "@/lib/requestAudit";
import { parseWebhookPayload } from "@/lib/webhookRequest";

export const dynamic = "force-dynamic";

type SummaryActionInput = {
  threadRef?: string;
  channel?: string;
  contactId?: string;
  email?: string;
  phone?: string;
  fullName?: string;
  writeToCrm?: boolean | string;
  maxChars?: number | string;
  limit?: number | string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function boolValue(value: unknown): boolean {
  return value === true || ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(clean(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertSummaryActionSecret(request: NextRequest): void {
  const expected = process.env.CLOSEBOT_PARITY_CUSTOM_ACTION_SECRET || process.env.CHANNEL_WEBHOOK_SECRET || "";
  if (!expected) return;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const actual = bearer || request.headers.get("x-lumenosis-webhook-secret") || request.nextUrl.searchParams.get("secret") || "";
  if (actual !== expected) throw new Error("Invalid custom action secret");
}

async function resolveContactId(input: SummaryActionInput): Promise<string> {
  if (clean(input.contactId)) return clean(input.contactId);
  const adapter = resolveCrmAdapter();
  if (!adapter) return "";
  const phone = clean(input.phone);
  const email = clean(input.email);
  const contact = phone
    ? await adapter.findContactByPhone(phone).catch(() => null)
    : email
      ? await adapter.findContactByEmail(email).catch(() => null)
      : null;
  return contact?.id || "";
}

export async function POST(request: NextRequest) {
  const audit = createRequestAudit({
    headers: request.headers,
    route: "/api/actions/summarize-conversation",
    method: "POST",
    provider: "ghl_custom_action",
  });

  try {
    assertSummaryActionSecret(request);
    const payload = (await parseWebhookPayload(request)) as SummaryActionInput;
    const threadRef = clean(payload.threadRef);
    const limit = Math.min(250, Math.max(1, numberValue(payload.limit, 80)));

    await audit.write("received", "received", {
      channel: clean(payload.channel) || undefined,
      contactRef: threadRef || clean(payload.phone) || clean(payload.email) || clean(payload.contactId),
      metadata: { writeToCrm: boolValue(payload.writeToCrm) },
    });

    if (!databaseEnabled()) {
      await audit.write("failed", "failed", { errorCode: "database_disabled", errorMessage: "DATABASE_URL is not configured." });
      return NextResponse.json({ ok: false, error: "DATABASE_URL is required to summarize conversation history." }, { status: 503 });
    }

    const events = threadRef
      ? await readEventsForThreadFromDatabase(threadRef, limit)
      : await readEventsForContactIdentityFromDatabase({
        channel: clean(payload.channel),
        email: clean(payload.email),
        phone: clean(payload.phone),
        fullName: clean(payload.fullName),
        limit,
      });

    const contactId = await resolveContactId(payload);
    const summary = buildConversationSummary({
      events,
      contact: {
        contactId: contactId || clean(payload.contactId) || undefined,
        fullName: clean(payload.fullName) || undefined,
        email: clean(payload.email) || undefined,
        phone: clean(payload.phone) || undefined,
      },
      maxChars: numberValue(payload.maxChars, 1800),
    });

    let savedToCrm = false;
    let crmStatus = "not_requested";
    if (boolValue(payload.writeToCrm)) {
      const adapter = resolveCrmAdapter();
      if (!adapter) {
        crmStatus = "crm_not_configured";
      } else if (!contactId) {
        crmStatus = "contact_not_found";
      } else if (!adapter.updateContactCustomFields) {
        crmStatus = "crm_adapter_missing_custom_fields";
      } else {
        await adapter.updateContactCustomFields(contactId, [customFieldFromConversationSummary(summary)]);
        savedToCrm = true;
        crmStatus = "saved";
      }
    }

    await audit.write("completed", "success", {
      channel: summary.preferredChannel,
      contactRef: threadRef || summary.contact.phone || summary.contact.email || contactId,
      metadata: { eventCount: summary.eventCount, savedToCrm, crmStatus },
    });

    return NextResponse.json({ ok: true, summary: summary.text, details: summary, eventCount: summary.eventCount, savedToCrm, crmStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to summarize conversation.";
    const unauthorized = message.toLowerCase().includes("secret");
    await audit.write("failed", "failed", {
      statusCode: unauthorized ? 401 : 500,
      errorCode: unauthorized ? "unauthorized" : "summarize_conversation_failed",
      errorMessage: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: unauthorized ? 401 : 500 });
  }
}
