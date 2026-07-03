import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { composioEnabled } from "@/lib/composioConnection";
import { composioImportConfig, pullComposioLeadRows } from "@/lib/composioLeadImport";
import { resolveCrmAdapter } from "@/lib/crm";
import { CRM_PROVIDER_DEFINITIONS, directCrmAdapterKey, normalizeCrmProvider } from "@/lib/crm/providers";
import { hasCrmImport } from "@/lib/crm/types";
import { readLeadImportBatchesFromDatabase, readLeadImportItemsFromDatabase } from "@/lib/database";
import { readSheet } from "@/lib/googleSheets";
import {
  LEAD_IMPORT_SOURCE_TYPES,
  parseCsv,
  runLeadImport,
  type LeadImportSourceType,
} from "@/lib/leadImport";
import { LEAD_MEMORY_TAB } from "@/lib/sheetSchema";

export const dynamic = "force-dynamic";

function sourceTypeFrom(value: unknown): LeadImportSourceType {
  const candidate = String(value || "csv");
  return LEAD_IMPORT_SOURCE_TYPES.includes(candidate as LeadImportSourceType) ? candidate as LeadImportSourceType : "csv";
}

function truthy(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function configured(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

function connectorStatuses() {
  const adapter = resolveCrmAdapter();
  const activeCrmProvider = normalizeCrmProvider(adapter?.provider || process.env.CRM_PROVIDER || "ghl");
  const activeCrmSupportsImport = hasCrmImport(adapter);
  const hasGhlCredentials = configured(process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_LOCATION_PIT)
    && configured(process.env.GHL_LOCATION_ID);
  const hasKvcoreCredentials = configured(process.env.KVCORE_API_KEY);
  const hasFubCredentials = configured(process.env.FUB_API_KEY);
  const hasGoogleSheets = configured(process.env.GOOGLE_SHEET_ID);
  const hasComposio = composioEnabled();
  const composioImport = composioImportConfig();

  const directStatus = (providerId: string) => {
    if (providerId === "ghl") return activeCrmProvider === "ghl" && activeCrmSupportsImport ? "ready" : hasGhlCredentials ? "configured" : "needs_config";
    if (providerId === "fub") return activeCrmProvider === "fub" && adapter ? "configured" : hasFubCredentials ? "configured" : "needs_config";
    if (providerId === "kvcore" || providerId === "lofty_chime") return (activeCrmProvider === providerId || directCrmAdapterKey(providerId) === "kvcore") && adapter ? "configured" : hasKvcoreCredentials ? "configured" : "needs_config";
    return "needs_config";
  };

  const crmConnectors = CRM_PROVIDER_DEFINITIONS.map((provider) => {
    if (provider.id === "none") {
      return {
        id: provider.id,
        label: provider.label,
        provider: provider.id,
        path: provider.path,
        status: "fallback",
        detail: provider.detail,
        action: "Use lead memory",
      };
    }
    if (provider.path === "direct_adapter") {
      const status = directStatus(provider.id);
      return {
        id: provider.id,
        label: provider.label,
        provider: provider.id,
        path: provider.path,
        status,
        detail: status === "ready" ? "Active CRM adapter supports lead import." : provider.detail,
        action: status === "ready" ? "Preview CRM leads" : "Configure CRM",
      };
    }
    if (provider.path === "composio") {
      const ready = hasComposio && Boolean(composioImport);
      return {
        id: provider.id,
        label: provider.label,
        provider: provider.id,
        path: provider.path,
        status: ready ? "ready" : hasComposio ? "configured" : "needs_config",
        detail: ready ? `Ready through Composio import tool ${composioImport?.toolSlug}.` : provider.detail,
        action: ready ? "Preview CRM leads" : "Connect via Composio",
      };
    }
    return {
      id: provider.id,
      label: provider.label,
      provider: provider.id,
      path: provider.path,
      status: provider.path === "csv_first" ? "fallback" : "planned",
      detail: provider.detail,
      action: "Import CSV",
    };
  });

  return [
    {
      id: "csv",
      label: "CSV / export",
      provider: "csv_export",
      path: "fallback",
      status: "ready",
      detail: "Works today for any CRM export.",
      action: "Choose CSV file",
    },
    {
      id: "google_sheets",
      label: "Google Sheets",
      provider: "google_sheets",
      path: "composio_or_direct",
      status: hasGoogleSheets ? "configured" : "needs_config",
      detail: hasGoogleSheets ? "Sheet source is configured." : "Needs GOOGLE_SHEET_ID before import.",
      action: hasGoogleSheets ? "Preview sheet leads" : "Configure sheet",
    },
    ...crmConnectors,
  ];
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
  if (body.pullSheets) {
    const rows = await readSheet(LEAD_MEMORY_TAB);
    return {
      rows,
      sourceType: "google_sheets",
      sourceProvider: "google_sheets",
      sourceName: String(body.sourceName || LEAD_MEMORY_TAB),
      filename: "",
      dryRun: Boolean(body.dryRun),
      metadata: { tab: LEAD_MEMORY_TAB },
    };
  }
  if (body.pullComposio) {
    const { rows: composioRows, config } = await pullComposioLeadRows();
    return {
      rows: composioRows,
      sourceType: "composio",
      sourceProvider: String(body.sourceProvider || config.toolkit || "composio"),
      sourceName: String(body.sourceName || config.toolSlug),
      filename: "",
      dryRun: Boolean(body.dryRun),
      metadata: {
        tool_slug: config.toolSlug,
        toolkit: config.toolkit,
        result_path: config.resultPath,
        connected_account_id: config.connectedAccountId || "",
      },
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
    const connectors = connectorStatuses();
    try {
      const batches = await readLeadImportBatchesFromDatabase(limit);
      const items = batchId ? await readLeadImportItemsFromDatabase(batchId, itemsLimit) : [];
      return NextResponse.json({ ok: true, connectors, batches, items });
    } catch (error) {
      const batchesError = error instanceof Error ? error.message : "Unable to load import batches.";
      return NextResponse.json({ ok: true, connectors, batches: [], items: [], batchesError });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load import status.";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
