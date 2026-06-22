import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { getContact, softDeleteContact, upsertContact, type ContactRecord } from "@/lib/contactOs";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

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

async function routeId(context: RouteContext): Promise<string> {
  return (await context.params).id;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const contact = await getContact(await routeId(context));
  if (!contact) return NextResponse.json({ ok: false, error: "Contact not found" }, { status: 404 });
  return NextResponse.json({ ok: true, contact: apiContact(contact) });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const id = await routeId(context);
  const body = await request.json().catch(() => ({}));
  const contact = await upsertContact({
    id,
    fullName: body.fullName || body.name,
    firstName: body.firstName,
    lastName: body.lastName,
    emails: Array.isArray(body.emails) ? body.emails : [body.email].filter(Boolean),
    phones: Array.isArray(body.phones) ? body.phones : [body.phone].filter(Boolean),
    company: body.company,
    source: body.source,
    leadSource: body.leadSource,
    leadStatus: body.leadStatus || body.status,
    assignedUserId: body.assignedUserId,
    propertyInterest: body.propertyInterest || body.address,
    buyerSellerRenter: body.buyerSellerRenter || body.role,
    budget: body.budget,
    timeline: body.timeline || body.nextStep,
    doNotContact: body.doNotContact,
    customFields: body.customFields,
  });
  return NextResponse.json({ ok: true, contact: apiContact(contact) });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const ok = await softDeleteContact(await routeId(context));
  if (!ok) return NextResponse.json({ ok: false, error: "Contact not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
