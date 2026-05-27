import { NextResponse } from "next/server";

import { readSheet } from "@/lib/googleSheets";
import { buildPropertyHealth } from "@/lib/inboxData";
import { PROPERTIES_TAB } from "@/lib/sheetSchema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const properties = await readSheet(PROPERTIES_TAB);
    return NextResponse.json({ properties, propertyHealth: buildPropertyHealth(properties) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
