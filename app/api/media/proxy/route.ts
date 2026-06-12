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
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.toLowerCase().startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "Image is not fetchable" }, { status: 502 });
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
