import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { approveDemoRoom } from "@/lib/demo-admin-service";
import { sql } from "@/lib/turso";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  // Same shared service as /api/platform/demos/[id]/approve so behavior cannot fork.
  await approveDemoRoom(id, sql);
  return NextResponse.redirect(new URL("/admin/demos", request.url), 303);
}
