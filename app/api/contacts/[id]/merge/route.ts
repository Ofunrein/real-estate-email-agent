import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { mergeContacts } from "@/lib/contactOs";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const duplicateId = String(body.duplicateId || body.secondaryId || "").trim();
  if (!duplicateId) return NextResponse.json({ ok: false, error: "duplicateId is required" }, { status: 400 });
  const merged = await mergeContacts(id, duplicateId);
  if (!merged) return NextResponse.json({ ok: false, error: "Contacts could not be merged" }, { status: 400 });
  return NextResponse.json({ ok: true, merged });
}
