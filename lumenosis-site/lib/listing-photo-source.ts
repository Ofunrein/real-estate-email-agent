/**
 * Deterministic, MLS-keyed listing photo retrieval.
 *
 * Why this module exists
 * ---------------------
 * The original generate route asked gpt-4o-mini to *return* three image URLs from Tavily
 * search text. That is generation, not retrieval: a language model emitting a CDN URL is
 * producing a plausible-looking string, and a plausible Zillow CDN path very often belongs
 * to a different property. This is the concrete cause of the wrong-building photo in an
 * earlier demo. Vision QA cannot rescue it either — a genuine photo of a *different*
 * condo is a real property photo, so `isRealPropertyPhoto` passes and only
 * `matchesExactListing` could object, which asks the model to confirm identity from pixels
 * it cannot verify.
 *
 * The fix is to never let a model mint a URL. Photos are retrieved from the listing page
 * itself, keyed by MLS number, and every candidate must be corroborated by the page that
 * asserts that MLS number. No corroboration, no photo.
 *
 * Ordering of the ladder is deliberate: strongest provenance first, and we stop at the
 * first rung that yields enough verified photos.
 *
 *   1. Structured data on the listing page (JSON-LD / OpenGraph). Publishers emit
 *      machine-readable image arrays for exactly this purpose; this is the highest-fidelity
 *      source and needs no scraping heuristics.
 *   2. The page's own media markup, restricted to known listing CDN hosts, and only when
 *      the page also states the expected MLS number.
 *   3. Street View for the exterior, clearly labelled as such.
 *
 * Rung 3 is a labelled fallback rather than a silent substitute: a Street View frame is a
 * real photograph of the real address, but it is not a listing photo, and a demo that
 * quietly passes it off as one is misleading. Callers receive `provenance` and must decide.
 */

import { isAllowedListingImage } from "@/lib/listing-image-hosts";

export type PhotoProvenance = "structured-data" | "page-media" | "street-view";

export type SourcedPhoto = {
  url: string;
  provenance: PhotoProvenance;
  /** The evidence that ties this URL to the requested listing. */
  corroboration: string;
};

export type SourceResult = { ok: true; photos: SourcedPhoto[] } | { ok: false; reason: string };

const REQUIRED_PHOTOS = 3;

/**
 * Normalise an MLS number for comparison. Publishers format the same number many ways
 * ("MLS# 1234567", "mls-1234567", "1234567"), so identity comparison has to ignore
 * punctuation, case, and the MLS prefix itself. Kept intentionally strict about digits:
 * we compare the alphanumeric core, never a substring match, so listing 123 cannot be
 * treated as corroborating listing 1234.
 */
export function normalizeMls(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bmls\s*#?\s*/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Does `html` actually assert this MLS number? Word-boundary anchored on the normalised
 * text so a longer number cannot satisfy a shorter query.
 */
export function pageAssertsMls(html: string, mls: string): boolean {
  const target = normalizeMls(mls);
  if (target.length < 4) return false; // too short to be an identifying key
  const normalized = html.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return new RegExp(`(?:^| )${target}(?:$| )`).test(normalized);
}

/** Absolute http(s) only. Protocol-relative and data: URLs are rejected outright. */
function absoluteUrl(candidate: string, base: string): string | null {
  try {
    const resolved = new URL(candidate, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Pull image URLs out of JSON-LD blocks. Schema.org allows `image` to be a string, an
 * array, or an ImageObject with a `url`/`contentUrl`, so all shapes are handled rather
 * than assuming one.
 */
export function imagesFromStructuredData(html: string, base: string): string[] {
  const found: string[] = [];
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  const visit = (node: unknown) => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      const abs = absoluteUrl(node, base);
      if (abs) found.push(abs);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object") {
      const record = node as Record<string, unknown>;
      for (const key of ["url", "contentUrl"]) {
        if (typeof record[key] === "string") visit(record[key]);
      }
    }
  };

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue; // a malformed block must not abort the others
    }
    const queue: unknown[] = [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) {
        queue.push(...node);
        continue;
      }
      if (node && typeof node === "object") {
        const record = node as Record<string, unknown>;
        if ("image" in record) visit(record.image);
        for (const value of Object.values(record)) {
          if (value && typeof value === "object") queue.push(value);
        }
      }
    }
  }

  // OpenGraph is a reasonable secondary signal in the same tier: it is publisher-declared
  // rather than inferred from arbitrary markup.
  for (const match of html.matchAll(
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
  )) {
    const abs = absoluteUrl(match[1], base);
    if (abs) found.push(abs);
  }

  return found;
}

/** Image URLs from ordinary media markup, allowlisted hosts only. */
export function imagesFromPageMedia(html: string, base: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const abs = absoluteUrl(match[1], base);
    if (abs) found.push(abs);
  }
  for (const match of html.matchAll(/<source[^>]+srcset=["']([^"']+)["']/gi)) {
    // srcset is a comma-separated candidate list; take the URL part of each candidate.
    for (const candidate of match[1].split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (!url) continue;
      const abs = absoluteUrl(url, base);
      if (abs) found.push(abs);
    }
  }
  return found;
}

/** Deduplicate while preserving order, and keep only allowlisted listing CDN hosts. */
function acceptable(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    if (!isAllowedListingImage(url)) continue;
    out.push(url);
  }
  return out;
}

/**
 * Street View exterior for a verified address. Signed-key-free static endpoint; the caller
 * supplies the key. Returned with explicit provenance so it is never mistaken for a
 * listing photo.
 */
export function streetViewPhoto(address: string, apiKey: string): SourcedPhoto {
  const params = new URLSearchParams({
    size: "1200x800",
    location: address,
    fov: "80",
    pitch: "0",
    source: "outdoor",
    key: apiKey,
  });
  return {
    url: `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`,
    provenance: "street-view",
    corroboration: `Street View exterior geocoded from ${address}`,
  };
}

/**
 * Retrieve photos for one listing.
 *
 * Fails closed: if the listing page does not assert the expected MLS number we do not fall
 * back to "whatever images the page had", because that is precisely how a neighbouring
 * property's photo entered a demo. An unverifiable page yields no photos.
 */
export async function sourceListingPhotos(
  input: {
    listingUrl: string;
    mls: string;
    address: string;
    streetViewKey?: string;
    allowStreetViewFallback?: boolean;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<SourceResult> {
  let html: string;
  try {
    const response = await fetchImpl(input.listingUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; LumenosisDemoBot/1.0)" },
    });
    if (!response.ok) return { ok: false, reason: `listing page returned ${response.status}` };
    html = await response.text();
  } catch (error) {
    return { ok: false, reason: `listing page unreachable: ${(error as Error).message}` };
  }

  if (!pageAssertsMls(html, input.mls)) {
    return {
      ok: false,
      reason: `listing page does not assert MLS ${input.mls}; refusing to attribute its photos to this listing`,
    };
  }

  const base = input.listingUrl;
  const photos: SourcedPhoto[] = [];

  for (const url of acceptable(imagesFromStructuredData(html, base))) {
    photos.push({
      url,
      provenance: "structured-data",
      corroboration: `publisher structured data on page asserting MLS ${input.mls}`,
    });
    if (photos.length === REQUIRED_PHOTOS) return { ok: true, photos };
  }

  const already = new Set(photos.map((photo) => photo.url));
  for (const url of acceptable(imagesFromPageMedia(html, base))) {
    if (already.has(url)) continue;
    photos.push({
      url,
      provenance: "page-media",
      corroboration: `media markup on page asserting MLS ${input.mls}`,
    });
    if (photos.length === REQUIRED_PHOTOS) return { ok: true, photos };
  }

  if (photos.length < REQUIRED_PHOTOS && input.allowStreetViewFallback && input.streetViewKey) {
    photos.push(streetViewPhoto(input.address, input.streetViewKey));
  }

  if (photos.length < REQUIRED_PHOTOS) {
    return {
      ok: false,
      reason: `only ${photos.length} corroborated photo(s) for MLS ${input.mls}; need ${REQUIRED_PHOTOS}`,
    };
  }

  return { ok: true, photos: photos.slice(0, REQUIRED_PHOTOS) };
}
