import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_IMAGE_HOSTS = new Set([
  "photos.zillowstatic.com",
  "www.zillowstatic.com",
  "zillowstatic.com",
  "lh3.googleusercontent.com",
  "images.unsplash.com",
  "maps.googleapis.com",
]);

function allowedImageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const source = allowedImageUrl(request.nextUrl.searchParams.get("url") || "");
  if (!source) {
    return NextResponse.json({ ok: false, error: "Unsupported image URL" }, { status: 400 });
  }

  const response = await fetch(source, {
    headers: {
      "User-Agent": "LumenosisTheoMediaProxy/1.0",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(10_000),
  });
  // Redirects can leave the allowlist, so the final URL is re-checked.
  if (response.url && !allowedImageUrl(response.url)) {
    return NextResponse.json({ ok: false, error: "Unsupported image URL" }, { status: 400 });
  }
  const contentType = response.headers.get("content-type") || "";
  const lowerContentType = contentType.toLowerCase();
  if (!response.ok || !lowerContentType.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "Image is not fetchable" }, { status: 502 });
  }
  // SVG is a script-capable document; never serve it from our own origin.
  if (lowerContentType.includes("svg")) {
    return NextResponse.json({ ok: false, error: "Unsupported image type" }, { status: 415 });
  }

  const body = await response.arrayBuffer();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
