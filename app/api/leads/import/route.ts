import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { resolveCrmAdapter } from "@/lib/crm";
import { hasCrmImport } from "@/lib/crm/types";
import { readLeadImportBatchesFromDatabase, readLeadImportItemsFromDatabase } from "@/lib/database";
import {
  LEAD_IMPORT_SOURCE_TYPES,
  parseCsv,
  runLeadImport,
  type LeadImportSourceType,
} from "@/lib/leadImport";

export const dynamic = "force-dynamic";

function sourceTypeFrom(value: unknown): LeadImportSourceType {
  const candidate = String(value || "csv");
  return LEAD_IMPORT_SOURCE_TYPES.includes(candidate as LeadImportSourceType) ? candidate as LeadImportSourceType : "csv";
}

function truthy(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

async function payloadFromRequest(request: NextRequest): Promise<{
  rows: Record<string, unknown>[];
  sourceType: LeadImportSourceType;
  sourceProvider: string;
  sourceName: string;
  filename: string;
  dryRun: boolean;
  metadata: Record<string, unknown>;
}> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const csvText = typeof form.get("csvText") === "string" ? String(form.get("csvText")) : "";
    const text = file instanceof File ? await file.text() : csvText;
    if (!text.trim()) throw new Error("CSV file or csvText is required");
    const parsed = parseCsv(text);
    return {
      rows: parsed.rows,
      sourceType: sourceTypeFrom(form.get("sourceType")),
      sourceProvider: String(form.get("sourceProvider") || ""),
      sourceName: String(form.get("sourceName") || ""),
      filename: file instanceof File ? file.name : String(form.get("filename") || ""),
      dryRun: truthy(form.get("dryRun")),
      metadata: { content_type: contentType, headers: parsed.headers },
    };
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const rows = Array.isArray(body.rows) ? body.rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row))) : [];
  if (rows.length) {
    return {
      rows,
      sourceType: sourceTypeFrom(body.sourceType),
      sourceProvider: String(body.sourceProvider || ""),
      sourceName: String(body.sourceName || ""),
      filename: String(body.filename || ""),
      dryRun: Boolean(body.dryRun),
      metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : {},
    };
  }
  if (body.pullCrm) {
    const adapter = resolveCrmAdapter();
    if (!hasCrmImport(adapter)) throw new Error("Configured CRM does not support lead import yet");
    const page = await adapter.listImportableLeads({
      limit: Number(body.limit || 100),
      cursor: body.cursor ? String(body.cursor) : undefined,
      updatedAfter: body.updatedAfter ? String(body.updatedAfter) : undefined,
    });
    return {
      rows: page.leads.map((lead) => ({
        "Contact ID": lead.sourceId || lead.id,
        "Full Name": lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(" "),
        "First Name": lead.firstName || "",
        "Last Name": lead.lastName || "",
        Email: lead.email || "",
        Phone: lead.phone || "",
        Tags: (lead.tags || []).join(";"),
        Stage: lead.stage || "",
        Owner: lead.owner || "",
        Notes: lead.notes || "",
        "Last Activity": lead.updatedAt || "",
        ...lead.raw,
      })),
      sourceType: "crm",
      sourceProvider: adapter.provider,
      sourceName: String(body.sourceName || adapter.provider),
      filename: "",
      dryRun: Boolean(body.dryRun),
      metadata: { next_cursor: page.nextCursor || "", connector: adapter.provider },
    };
  }
  const csvText = String(body.csvText || "");
  if (!csvText.trim()) throw new Error("rows or csvText is required");
  const parsed = parseCsv(csvText);
  return {
    rows: parsed.rows,
    sourceType: sourceTypeFrom(body.sourceType),
    sourceProvider: String(body.sourceProvider || ""),
    sourceName: String(body.sourceName || ""),
    filename: String(body.filename || ""),
    dryRun: Boolean(body.dryRun),
    metadata: { ...(body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : {}), headers: parsed.headers },
  };
}

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();

  try {
    const payload = await payloadFromRequest(request);
    const { summary, results } = await runLeadImport(payload.rows, {
      sourceType: payload.sourceType,
      sourceProvider: payload.sourceProvider,
      sourceName: payload.sourceName,
      filename: payload.filename,
      dryRun: payload.dryRun,
      metadata: payload.metadata,
    });
    return NextResponse.json({
      ok: true,
      dryRun: payload.dryRun,
      summary,
      preview: results.slice(0, 25).map((result) => ({
        rowIndex: result.rowIndex,
        status: result.status,
        email: result.normalized.email,
        phone: result.normalized.phone,
        fullName: result.normalized.fullName,
        segments: result.segments,
        campaignEligible: result.campaignEligible,
        unmappedColumns: result.unmappedColumns,
        errors: result.errors,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import leads.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();

  try {
    const batchId = request.nextUrl.searchParams.get("batchId") || "";
    const limit = Number(request.nextUrl.searchParams.get("limit") || 20);
    const itemsLimit = Number(request.nextUrl.searchParams.get("itemsLimit") || 50);
    const batches = await readLeadImportBatchesFromDatabase(limit);
    const items = batchId ? await readLeadImportItemsFromDatabase(batchId, itemsLimit) : [];
    return NextResponse.json({ ok: true, batches, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load import batches.";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
