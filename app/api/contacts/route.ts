import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { listContacts, upsertContact, type ContactRecord } from "@/lib/contactOs";

export const dynamic = "force-dynamic";

function apiContact(contact: ContactRecord) {
  return {
    ...contact,
    name: contact.full_name,
    fullName: contact.full_name,
    status: contact.lead_status,
    email: contact.emails?.[0] || "",
    phone: contact.phones?.[0] || "",
    role: contact.buyer_seller_renter || "Lead",
    address: contact.property_interest || "",
    lastTouch: contact.last_activity_at || contact.updated_at || contact.created_at,
    nextStep: contact.timeline || "Review contact",
    notes: contact.budget || contact.property_interest || "",
  };
}

export async function GET(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const params = request.nextUrl.searchParams;
  try {
    const contacts = await listContacts({
      search: params.get("search") || params.get("q") || undefined,
      status: params.get("status") || undefined,
      company: params.get("company") || undefined,
      includeDeleted: params.get("includeDeleted") === "1",
      limit: Number(params.get("limit") || 100),
    });
    return NextResponse.json({ ok: true, contacts: contacts.map(apiContact) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: /DATABASE_URL|relation/.test(message) ? 503 : 400 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  try {
    const contact = await upsertContact({
      fullName: body.fullName || body.name,
      firstName: body.firstName,
      lastName: body.lastName,
      emails: Array.isArray(body.emails) ? body.emails : [body.email].filter(Boolean),
      phones: Array.isArray(body.phones) ? body.phones : [body.phone].filter(Boolean),
      company: body.company,
      source: body.source || "manual",
      leadSource: body.leadSource,
      leadStatus: body.leadStatus || body.status,
      assignedUserId: body.assignedUserId,
      propertyInterest: body.propertyInterest || body.address,
      buyerSellerRenter: body.buyerSellerRenter || body.role,
      budget: body.budget,
      timeline: body.timeline || body.nextStep,
      doNotContact: body.doNotContact,
      customFields: body.customFields,
      rawProviderPayload: body.rawProviderPayload,
    });
    return NextResponse.json({ ok: true, contact: apiContact(contact) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
