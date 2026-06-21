import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VAPI_BASE = "https://api.vapi.ai";

type LiveTurn = { speaker: "ai" | "lead"; text: string };
type LiveStatus = {
  status: string; // queued | ringing | in-progress | forwarding | ended
  endedReason?: string;
  isVoicemail: boolean;
  transcript: LiveTurn[];
  durationSec: number;
  recordingUrl?: string;
};

// Poll a single Vapi call for live status + partial transcript.
// The dashboard hits this every ~1.5s while a manual call is active so the
// operator sees the conversation stream + voicemail detection in real time.
// GET /api/voice/live?callId=xxx
export async function GET(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId");
  if (!callId) {
    return NextResponse.json({ ok: false, error: "Missing callId" }, { status: 400 });
  }
  const apiKey = process.env.VAPI_API_KEY || "";
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Voice not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${VAPI_BASE}/call/${callId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Vapi ${res.status}` }, { status: 502 });
    }
    const call = (await res.json()) as Record<string, any>;

    const status = String(call.status || "queued");
    const endedReason = call.endedReason ? String(call.endedReason) : undefined;
    const isVoicemail =
      Boolean(call.endedReason && String(call.endedReason).toLowerCase().includes("voicemail")) ||
      String(call.analysis?.successEvaluation || "").toLowerCase().includes("voicemail");

    // Transcript can arrive as messages[] (role/message) or a single transcript string.
    const turns: LiveTurn[] = [];
    const messages = Array.isArray(call.messages) ? call.messages : Array.isArray(call.artifact?.messages) ? call.artifact.messages : [];
    for (const m of messages) {
      const role = String(m.role || "").toLowerCase();
      if (role !== "assistant" && role !== "user" && role !== "bot") continue;
      const text = String(m.message || m.content || "").trim();
      if (!text) continue;
      turns.push({ speaker: role === "user" ? "lead" : "ai", text });
    }

    let durationSec = 0;
    if (call.startedAt) {
      const start = new Date(call.startedAt).getTime();
      const end = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
      durationSec = Math.max(0, Math.round((end - start) / 1000));
    }

    const payload: LiveStatus = {
      status,
      endedReason,
      isVoicemail,
      transcript: turns,
      durationSec,
      recordingUrl: call.recordingUrl || call.artifact?.recordingUrl || undefined,
    };
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fetch call status";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
