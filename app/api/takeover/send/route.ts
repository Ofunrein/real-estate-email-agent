import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { threadId, channel } = await req.json().catch(() => ({}));

  return NextResponse.json(
    {
      ok: false,
      error: "Deprecated endpoint. Use /api/threads/[threadRef]/reply so text, attachments, and media-only sends use the real provider path.",
      replacement: threadId ? `/api/threads/${encodeURIComponent(threadId)}/reply` : "/api/threads/[threadRef]/reply",
      channel: channel || "",
    },
    { status: 410 },
  );
}
