const PROXIABLE_IMAGE_HOSTS = new Set([
  "photos.zillowstatic.com",
  "www.zillowstatic.com",
  "zillowstatic.com",
  "lh3.googleusercontent.com",
  "images.unsplash.com",
  "maps.googleapis.com",
]);

export function isGoogleStreetViewUrl(value = ""): boolean {
  return /maps\.googleapis\.com\/maps\/api\/streetview/i.test(value.trim());
}

export function unwrapMediaProxyUrl(value: string): string {
  try {
    const url = new URL(value, "http://local");
    if (url.pathname === "/api/media/proxy") {
      return url.searchParams.get("url") || value;
    }
  } catch {
    return value;
  }
  return value;
}

export function isProxiableImageUrl(value: string): boolean {
  try {
    const raw = unwrapMediaProxyUrl(value);
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return PROXIABLE_IMAGE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function mediaProxyPath(url: string): string {
  const raw = unwrapMediaProxyUrl(url.trim());
  if (isGoogleStreetViewUrl(raw)) return raw;
  if (!raw || !isProxiableImageUrl(raw)) return url;
  return `/api/media/proxy?url=${encodeURIComponent(raw)}`;
}

export function mediaProxyUrl(url: string, baseUrl?: string): string {
  const proxied = mediaProxyPath(url);
  if (!proxied.startsWith("/api/media/proxy")) return url;
  const base = (baseUrl || process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}${proxied}` : url;
}

export function usableInboxPhotoUrl(value?: string): string {
  const url = (value || "").trim();
  if (!url || isGoogleStreetViewUrl(url)) return "";
  return url;
}

export function addressStem(value?: string): string {
  return (value || "").split(",", 1)[0].trim().toLowerCase();
}

export function extractPropertyAddressFromEmailHtml(html: string): string {
  const h2Match = html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
  if (h2Match?.[1]) return h2Match[1].trim();
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return h1Match?.[1]?.trim() || "";
}

export function resolvePropertyPhotoFromSheet(
  address: string,
  properties: Array<{ address?: string; photo_url?: string }> = [],
): string {
  const stem = addressStem(address);
  if (!stem) return "";
  for (const property of properties) {
    const propertyStem = addressStem(property.address);
    if (!propertyStem) continue;
    if (propertyStem === stem || propertyStem.startsWith(stem) || stem.startsWith(propertyStem)) {
      const photo = usableInboxPhotoUrl(property.photo_url);
      if (photo) return photo;
    }
  }
  return "";
}

export function sanitizeEmailHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "")
    .replace(/\s(href|src)\s*=\s*(["'])\s*data:(?!image\/(?:png|jpe?g|gif|webp);)[\s\S]*?\2/gi, "");
}

export function rewriteEmailHtmlForInbox(
  html: string,
  properties: Array<{ address?: string; photo_url?: string }> = [],
): string {
  const sanitized = sanitizeEmailHtml(html);
  const address = extractPropertyAddressFromEmailHtml(sanitized);
  const sheetPhoto = address ? resolvePropertyPhotoFromSheet(address, properties) : "";

  return sanitized.replace(
    /<img\b([^>]*?\s)src=(["'])([^"']+)\2([^>]*)>/gi,
    (_full, beforeSrc, quote, src, afterSrc) => {
      let resolved = unwrapMediaProxyUrl(src.trim());
      if (isGoogleStreetViewUrl(resolved)) {
        resolved = sheetPhoto;
      }
      if (!resolved) {
        return '<span class="email-photo-placeholder" role="img" aria-label="Property photo unavailable">Photo unavailable</span>';
      }
      const proxied = mediaProxyPath(resolved);
      return `<img${beforeSrc}src=${quote}${proxied}${quote}${afterSrc}>`;
    },
  );
}

export function isDisplayableImageUrl(value: string): boolean {
  const lower = unwrapMediaProxyUrl(value).toLowerCase();
  return (
    /\.(png|jpe?g|gif|webp)(?:[?#].*)?$/.test(lower) ||
    lower.includes("photos.zillowstatic.com/") ||
    isProxiableImageUrl(value)
  );
}

export function inboxImagePreviewUrl(value: string): string {
  const raw = unwrapMediaProxyUrl(value);
  if (isGoogleStreetViewUrl(raw)) return "";
  if (isProxiableImageUrl(raw)) return mediaProxyPath(raw);
  return raw;
}
