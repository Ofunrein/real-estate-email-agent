import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { addContactNote } from "@/lib/contactOs";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const noteBody = String(body.body || body.note || "").trim();
  if (!noteBody) return NextResponse.json({ ok: false, error: "Note body is required" }, { status: 400 });
  const note = await addContactNote(id, noteBody, session.user?.email || "");
  return NextResponse.json({ ok: true, note });
}
