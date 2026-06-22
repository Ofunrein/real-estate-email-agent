import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { upsertContact } from "@/lib/contactOs";
import { buildImportPreview, parseCsv, type LeadImportRowResult } from "@/lib/leadImport";

export const dynamic = "force-dynamic";

function truthy(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

async function rowsFromRequest(request: NextRequest): Promise<{
  rows: Record<string, unknown>[];
  filename: string;
  dryRun: boolean;
}> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const csvText = typeof form.get("csvText") === "string" ? String(form.get("csvText")) : "";
    const text = file instanceof File ? await file.text() : csvText;
    if (!text.trim()) throw new Error("CSV file or csvText is required");
    return {
      rows: parseCsv(text).rows,
      filename: file instanceof File ? file.name : String(form.get("filename") || "contacts.csv"),
      dryRun: truthy(form.get("dryRun")),
    };
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (Array.isArray(body.rows)) {
    return {
      rows: body.rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row))),
      filename: String(body.filename || ""),
      dryRun: Boolean(body.dryRun),
    };
  }
  const csvText = String(body.csvText || "");
  if (!csvText.trim()) throw new Error("rows or csvText is required");
  return {
    rows: parseCsv(csvText).rows,
    filename: String(body.filename || "contacts.csv"),
    dryRun: Boolean(body.dryRun),
  };
}

function contactInputFrom(result: LeadImportRowResult) {
  const lead = result.normalized;
  return {
    fullName: lead.fullName,
    firstName: lead.firstName,
    lastName: lead.lastName,
    emails: lead.email ? [lead.email] : [],
    phones: lead.phone ? [lead.phone] : [],
    source: lead.sourceProvider || lead.sourceType || "csv",
    leadSource: lead.sourceProvider || lead.sourceType || "csv",
    leadStatus: result.segments.includes("do_not_contact")
      ? "do_not_contact"
      : result.segments.includes("hot_buyer")
        ? "hot"
        : result.segments.includes("showing_ready")
          ? "showing"
          : result.segments.includes("seller_valuation")
            ? "seller"
            : "nurture",
    propertyInterest: lead.propertyInterest || lead.area,
    buyerSellerRenter: lead.leadRole,
    budget: lead.budget,
    timeline: lead.timeline,
    doNotContact: lead.doNotContact,
    customFields: {
      owner: lead.owner,
      stage: lead.stage,
      intent: lead.intent,
      preferred_channel: lead.preferredChannel,
      sms_consent: lead.smsConsent,
      call_consent: lead.callConsent,
      whatsapp_consent: lead.whatsappConsent,
      segments: result.segments,
      campaign_eligible: result.campaignEligible,
      source_id: lead.sourceId,
    },
    rawProviderPayload: lead.raw,
  };
}

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();

  try {
    const payload = await rowsFromRequest(request);
    const preview = buildImportPreview(payload.rows, {
      sourceType: "csv",
      sourceProvider: "contacts_csv",
      sourceName: payload.filename || "Contacts CSV",
      filename: payload.filename,
      dryRun: payload.dryRun,
    });
    let saved = 0;
    const savedContacts: string[] = [];
    if (!payload.dryRun) {
      for (const result of preview.results) {
        if (result.status === "invalid" || result.status === "duplicate") continue;
        const contact = await upsertContact(contactInputFrom(result));
        savedContacts.push(contact.id);
        saved += 1;
      }
    }
    return NextResponse.json({
      ok: true,
      dryRun: payload.dryRun,
      summary: {
        ...preview.summary,
        batchId: "",
        importedContacts: payload.dryRun ? 0 : saved,
        mergedContacts: payload.dryRun ? 0 : preview.summary.duplicateRows,
        savedContacts,
      },
      preview: preview.results.slice(0, 25).map((result) => ({
        rowIndex: result.rowIndex,
        status: result.status,
        fullName: result.normalized.fullName,
        email: result.normalized.email,
        phone: result.normalized.phone,
        segments: result.segments,
        errors: result.errors,
        unmappedColumns: result.unmappedColumns,
      })),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to import contacts" }, { status: 400 });
  }
}
