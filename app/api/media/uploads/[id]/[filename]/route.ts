import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { readMediaUpload, verifyMediaAccessToken } from "@/lib/mediaUploads";

export const dynamic = "force-dynamic";

/**
 * Two ways in, both tenant-bound:
 *
 *   ?t=<token>  — an HMAC bound to (client, upload id), signed with this
 *                 deployment's secret. This is what Twilio's MMS fetcher uses;
 *                 it has no session and cannot get one.
 *   session     — a logged-in dashboard operator, scoped to their workspace.
 *
 * A bare id is not enough either way. It travels through audit rows and
 * outbound message bodies, so treating it as a capability would make every
 * upload readable by anyone who saw one.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; filename: string }> }) {
  const { id } = await params;

  const token = request.nextUrl.searchParams.get("t") || "";
  const tokenClientId = token ? verifyMediaAccessToken(id, token) : "";

  if (!tokenClientId) {
    const session = await requireDashboardAuth();
    if (!session) return unauthorizedResponse();
  }

  const upload = await readMediaUpload(id, tokenClientId || undefined);
  if (!upload) return NextResponse.json({ ok: false, error: "Media not found" }, { status: 404 });

  return new Response(new Uint8Array(upload.data), {
    headers: {
      "Content-Type": upload.contentType,
      "Content-Length": String(upload.size),
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${upload.filename.replace(/"/g, "")}"`,
    },
  });
}
