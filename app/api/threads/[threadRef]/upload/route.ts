import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads");
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

// ponytail: writes to public/uploads (local disk). Works for a self-hosted dashboard.
// On Vercel/read-only FS, swap for Blob/S3 — same return shape ({ url }).
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No file" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ ok: false, error: "File too large (max 10MB)" }, { status: 413 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ ok: false, error: `Type not allowed: ${file.type}` }, { status: 415 });

  const ext = file.name.split(".").pop() || "bin";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, filename), Buffer.from(await file.arrayBuffer()));

  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return NextResponse.json({ ok: true, url: `${base}/uploads/${filename}`, filename });
}
