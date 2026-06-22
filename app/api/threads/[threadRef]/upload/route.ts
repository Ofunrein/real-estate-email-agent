import { NextRequest, NextResponse } from "next/server";

import { normalizeManualVoiceUpload } from "@/lib/audioTranscode";
import { saveMediaUpload } from "@/lib/mediaUploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB (Twilio MMS limit ~5MB; WhatsApp/Gmail higher)
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/aac",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "application/pdf",
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadRef: string }> }) {
  try {
    const { threadRef } = await params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });
    if (!file.size) return NextResponse.json({ ok: false, error: "File is empty" }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ ok: false, error: "File too large (max 10MB)" }, { status: 413 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ ok: false, error: `Type not allowed: ${file.type || "unknown"}` }, { status: 415 });

    const normalizedFile = await normalizeManualVoiceUpload(file);
    const uploaded = await saveMediaUpload({ file: normalizedFile, threadRef, requestUrl: req.url });
    return NextResponse.json({ ok: true, ...uploaded });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
