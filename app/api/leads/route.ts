import { NextResponse } from "next/server";

import { readLeads } from "@/lib/dataSource";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ leads: await readLeads() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
