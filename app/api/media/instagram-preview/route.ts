import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INSTAGRAM_URL_RE = /^https:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv|stories)\//i;
const IMAGE_HOST_RE = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

function htmlAttr(value: string, name: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].replace(/&amp;/g, "&");
  }
  return "";
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("url") || "";
  let pageUrl: URL;
  try {
    pageUrl = new URL(target);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid Instagram URL" }, { status: 400 });
  }
  if (!INSTAGRAM_URL_RE.test(pageUrl.toString())) {
    return NextResponse.json({ ok: false, error: "Only Instagram media URLs are supported" }, { status: 400 });
  }

  const htmlRes = await fetch(pageUrl.toString(), {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
    },
    cache: "no-store",
  });
  if (!htmlRes.ok) {
    return NextResponse.json({ ok: false, error: "Instagram preview unavailable" }, { status: 502 });
  }
  const html = await htmlRes.text();
  const imageUrl = htmlAttr(html, "og:image") || htmlAttr(html, "twitter:image");
  if (!imageUrl) {
    return NextResponse.json({ ok: false, error: "Instagram preview image missing" }, { status: 404 });
  }
  const parsedImage = new URL(imageUrl);
  if (!IMAGE_HOST_RE.test(parsedImage.hostname)) {
    return NextResponse.json({ ok: false, error: "Unsupported preview host" }, { status: 400 });
  }
  const imageRes = await fetch(parsedImage.toString(), {
    headers: {
      "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "referer": pageUrl.toString(),
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
    },
    cache: "no-store",
  });
  if (!imageRes.ok || !imageRes.body) {
    return NextResponse.json({ ok: false, error: "Instagram preview fetch failed" }, { status: 502 });
  }
  return new NextResponse(imageRes.body, {
    headers: {
      "content-type": imageRes.headers.get("content-type") || "image/jpeg",
      "cache-control": "public, max-age=21600, stale-while-revalidate=86400",
    },
  });
}
