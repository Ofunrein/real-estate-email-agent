import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_AUDIO_HOSTS = new Set([
  "storage.vapi.ai",
  "recordings.vapi.ai",
]);

function allowedAudioUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_AUDIO_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const source = allowedAudioUrl(request.nextUrl.searchParams.get("url") || "");
  if (!source) {
    return NextResponse.json({ ok: false, error: "Unsupported audio URL" }, { status: 400 });
  }

  const range = request.headers.get("range") || "";
  const response = await fetch(source, {
    headers: {
      "User-Agent": "LumenosisVoiceMediaProxy/1.0",
      Accept: "audio/*,*/*;q=0.8",
      ...(range ? { Range: range } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get("content-type") || "audio/mpeg";
  if (!response.ok && response.status !== 206) {
    return NextResponse.json({ ok: false, error: "Audio is not fetchable" }, { status: 502 });
  }
  if (!contentType.toLowerCase().startsWith("audio/")) {
    return NextResponse.json({ ok: false, error: "URL is not audio" }, { status: 502 });
  }

  const body = await response.arrayBuffer();
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  });
  for (const header of ["content-length", "content-range"]) {
    const value = response.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new NextResponse(body, {
    status: response.status === 206 ? 206 : 200,
    headers,
  });
}
