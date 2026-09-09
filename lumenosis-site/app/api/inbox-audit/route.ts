import { NextRequest, NextResponse } from "next/server";

const GHL_API = "https://services.leadconnectorhq.com/contacts/";

type AuditLead = {
  name?: string;
  email?: string;
  phone?: string;
  auditScore?: number;
  leadVolume?: string;
  responseTime?: string;
  coverage?: string;
  channels?: string[];
};

export async function POST(request: NextRequest) {
  const lead = (await request.json().catch(() => null)) as AuditLead | null;
  if (!lead?.name?.trim() || !/^\S+@\S+\.\S+$/.test(lead.email ?? "")) {
    return NextResponse.json({ error: "Name and a valid email are required" }, { status: 400 });
  }

  const token = process.env.GHL_LOCATION_PIT;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) return NextResponse.json({ ok: true, downstream: "not_configured" });

  const name = lead.name.trim();
  const email = (lead.email as string).trim().toLowerCase();
  const [firstName, ...lastName] = name.split(/\s+/);
  const response = await fetch(GHL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locationId,
      firstName,
      lastName: lastName.join(" ") || undefined,
      email,
      phone: lead.phone || undefined,
      source: "Lumenosis Inbox Coverage Audit",
      tags: ["inbox-audit", `audit-score-${lead.auditScore ?? 0}`],
      customFields: [
        { key: "inbox_audit_score", field_value: String(lead.auditScore ?? "") },
        { key: "inbox_audit_lead_volume", field_value: lead.leadVolume ?? "" },
        { key: "inbox_audit_response_time", field_value: lead.responseTime ?? "" },
        { key: "inbox_audit_coverage", field_value: lead.coverage ?? "" },
        { key: "inbox_audit_channels", field_value: (lead.channels ?? []).join(", ") },
      ],
    }),
    cache: "no-store",
  }).catch(() => null);

  return NextResponse.json({ ok: true, downstream: response?.ok ? "delivered" : "failed" });
}
