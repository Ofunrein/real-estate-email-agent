import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth, unauthorizedResponse } from "@/lib/authGuard";
import { normalizeManualVoiceUpload } from "@/lib/audioTranscode";
import { saveMediaUpload } from "@/lib/mediaUploads";
import { createRequestAudit } from "@/lib/requestAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB (Twilio MMS limit ~5MB; WhatsApp/Gmail higher)
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/aac",
  "audio/caf",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-caf",
  "video/mp4",
  "video/webm",
  "application/pdf",
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadRef } = await params;
  const audit = createRequestAudit({
    headers: req.headers,
    route: "/api/threads/[threadRef]/upload",
    method: "POST",
    provider: "dashboard",
    threadRef,
  });
  await audit.write("received", "received");
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      await audit.write("upload", "failed", { statusCode: 400, errorMessage: "No file" });
      return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });
    }
    if (!file.size) {
      await audit.write("upload", "failed", { statusCode: 400, errorMessage: "File is empty" });
      return NextResponse.json({ ok: false, error: "File is empty" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      await audit.write("upload", "failed", { statusCode: 413, errorMessage: "File too large (max 10MB)", metadata: { size: file.size, type: file.type } });
      return NextResponse.json({ ok: false, error: "File too large (max 10MB)" }, { status: 413 });
    }
    const baseType = (file.type || "").split(";", 1)[0].trim().toLowerCase();
    if (!ALLOWED.has(baseType)) {
      await audit.write("upload", "failed", { statusCode: 415, errorMessage: `Type not allowed: ${file.type || "unknown"}`, metadata: { size: file.size, type: file.type } });
      return NextResponse.json({ ok: false, error: `Type not allowed: ${file.type || "unknown"}` }, { status: 415 });
    }

    const uploadFile = file.type === baseType ? file : new File([file], file.name, { type: baseType });
    const normalizedFile = await normalizeManualVoiceUpload(uploadFile);
    const uploaded = await saveMediaUpload({ file: normalizedFile, threadRef, requestUrl: req.url });
    await audit.write("upload", "sent", {
      statusCode: 200,
      metadata: { filename: normalizedFile.name, type: normalizedFile.type, size: normalizedFile.size },
    });
    return NextResponse.json({ ok: true, ...uploaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    await audit.write("upload", "failed", { statusCode: 500, errorCode: "upload_failed", errorMessage: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
