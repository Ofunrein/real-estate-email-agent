import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { inngest } from "@/lib/inngest/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function expectedToken(): string {
  return process.env.GOOGLE_DRIVE_WEBHOOK_TOKEN || "";
}

function header(request: NextRequest, name: string): string {
  return request.headers.get(name) || "";
}

function authorized(request: NextRequest): boolean {
  const token = expectedToken();
  if (!token) return false;
  return safeEqual(header(request, "x-goog-channel-token"), token);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    webhook: "google-drive-sheets",
    configured: Boolean(expectedToken()),
  });
}

export async function POST(request: NextRequest) {
  if (!expectedToken()) {
    return NextResponse.json({ ok: false, error: "GOOGLE_DRIVE_WEBHOOK_TOKEN is required" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const channelId = header(request, "x-goog-channel-id");
  const resourceId = header(request, "x-goog-resource-id");
  const resourceState = header(request, "x-goog-resource-state");
  const messageNumber = header(request, "x-goog-message-number");
  if (!channelId || !resourceId || !messageNumber) {
    return NextResponse.json({ ok: false, error: "Missing Google Drive notification headers" }, { status: 400 });
  }

  await inngest.send({
    name: "sheets.changed",
    data: {
      channelId,
      resourceId,
      resourceState,
      messageNumber,
      changed: header(request, "x-goog-changed"),
      resourceUri: header(request, "x-goog-resource-uri"),
      triggeredAt: new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true, queued: true });
}
