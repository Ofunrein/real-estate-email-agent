import { NextRequest, NextResponse } from "next/server";

import { handleAgentSmsControl } from "@/lib/ariaSmsControl";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.formData();
  await handleAgentSmsControl(String(body.get("From") || ""), String(body.get("Body") || ""));
  return new NextResponse("<Response></Response>", {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
