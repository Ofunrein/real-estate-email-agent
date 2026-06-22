import { NextResponse } from "next/server";

import { readMediaUpload } from "@/lib/mediaUploads";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; filename: string }> }) {
  const { id } = await params;
  const upload = await readMediaUpload(id);
  if (!upload) return NextResponse.json({ ok: false, error: "Media not found" }, { status: 404 });

  return new Response(new Uint8Array(upload.data), {
    headers: {
      "Content-Type": upload.contentType,
      "Content-Length": String(upload.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${upload.filename.replace(/"/g, "")}"`,
    },
  });
}
