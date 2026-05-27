import { NextResponse } from "next/server";

import { readSheet } from "@/lib/googleSheets";
import { LEAD_MEMORY_TAB } from "@/lib/sheetSchema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ leads: await readSheet(LEAD_MEMORY_TAB) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
