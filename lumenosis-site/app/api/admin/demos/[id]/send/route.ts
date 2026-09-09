import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { sendDemoOutreach } from "@/lib/demo-admin-service";
import { sql } from "@/lib/turso";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  // Same shared service as /api/platform/demos/[id]/send so behavior cannot fork.
  const result = await sendDemoOutreach(id, sql);
  if (!result.ok) {
    if (result.reason === "not_found")
      return NextResponse.json({ error: "Approved draft not found" }, { status: 404 });
    if (result.reason === "not_configured")
      return NextResponse.json({ error: "AgentMail is not configured" }, { status: 503 });
    return NextResponse.json({ error: "AgentMail send failed" }, { status: 502 });
  }
  return NextResponse.redirect(new URL("/admin/demos", request.url), 303);
}
