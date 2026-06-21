import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VAPI_BASE = "https://api.vapi.ai";

// End an in-progress Vapi call from the dashboard. Session-protected.
// POST { callId }
export async function POST(request: NextRequest) {
  try {
    const { callId } = (await request.json().catch(() => ({}))) as { callId?: string };
    if (!callId) {
      return NextResponse.json({ ok: false, error: "Missing callId" }, { status: 400 });
    }
    const apiKey = process.env.VAPI_API_KEY || "";
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "Voice not configured" }, { status: 503 });
    }
    // Vapi ends a live call via PATCH status=ended (or DELETE on some plans).
    const res = await fetch(`${VAPI_BASE}/call/${callId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ended" }),
    });
    if (!res.ok) {
      // Non-fatal: call may already be over. Report but don't 500 the UI.
      return NextResponse.json({ ok: false, error: `Vapi ${res.status}` }, { status: 200 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to end call";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
