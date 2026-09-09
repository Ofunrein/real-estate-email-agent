import { expect, test } from "@playwright/test";
import {
  imagesFromPageMedia,
  imagesFromStructuredData,
  normalizeMls,
  pageAssertsMls,
  sourceListingPhotos,
  streetViewPhoto,
} from "@/lib/listing-photo-source";

const MLS = "73412988";

/** Minimal listing page that asserts the MLS number and carries N Zillow-hosted photos. */
function listingPage(options: {
  mls?: string;
  jsonLdImages?: string[];
  imgTags?: string[];
  ogImage?: string;
} = {}) {
  const mls = options.mls ?? MLS;
  const jsonLd = options.jsonLdImages
    ? `<script type="application/ld+json">${JSON.stringify({
        "@type": "SingleFamilyResidence",
        image: options.jsonLdImages,
      })}</script>`
    : "";
  const og = options.ogImage
    ? `<meta property="og:image" content="${options.ogImage}" />`
    : "";
  const imgs = (options.imgTags ?? []).map((src) => `<img src="${src}" />`).join("");
  return `<html><head>${jsonLd}${og}</head><body><p>MLS# ${mls}</p>${imgs}</body></html>`;
}

function stubFetch(body: string, status = 200) {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

test("normalizeMls strips prefix, case, and punctuation", () => {
  expect(normalizeMls("MLS# 73412988")).toBe("73412988");
  expect(normalizeMls("mls-73412988")).toBe("73412988");
  expect(normalizeMls("73412988")).toBe("73412988");
});

test("pageAssertsMls requires a whole-token match, not a substring", () => {
  expect(pageAssertsMls("<p>MLS# 73412988</p>", MLS)).toBe(true);
  // A longer number that merely contains ours must NOT count as corroboration, otherwise
  // listing 734129 would validate against listing 7341298812.
  expect(pageAssertsMls("<p>MLS# 734129881234</p>", MLS)).toBe(false);
  expect(pageAssertsMls("<p>no mls here</p>", MLS)).toBe(false);
});

test("pageAssertsMls refuses keys too short to identify a listing", () => {
  expect(pageAssertsMls("<p>MLS# 12</p>", "12")).toBe(false);
});

test("structured data extraction handles string, array, and ImageObject shapes", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "House",
    image: [
      "https://photos.zillowstatic.com/fp/a.jpg",
      { "@type": "ImageObject", contentUrl: "https://photos.zillowstatic.com/fp/b.jpg" },
    ],
  })}</script>`;
  const found = imagesFromStructuredData(html, "https://www.zillow.com/homedetails/x/");
  expect(found).toContain("https://photos.zillowstatic.com/fp/a.jpg");
  expect(found).toContain("https://photos.zillowstatic.com/fp/b.jpg");
});

test("a malformed JSON-LD block does not abort sibling blocks", () => {
  const html =
    `<script type="application/ld+json">{ not json </script>` +
    `<script type="application/ld+json">${JSON.stringify({
      image: "https://photos.zillowstatic.com/fp/good.jpg",
    })}</script>`;
  expect(imagesFromStructuredData(html, "https://www.zillow.com/")).toContain(
    "https://photos.zillowstatic.com/fp/good.jpg",
  );
});

test("relative and protocol-relative srcs resolve or are rejected", () => {
  const html = `<img src="/fp/rel.jpg" /><img src="data:image/png;base64,AAA" />`;
  const found = imagesFromPageMedia(html, "https://photos.zillowstatic.com/listing/");
  expect(found).toContain("https://photos.zillowstatic.com/fp/rel.jpg");
  expect(found.some((url) => url.startsWith("data:"))).toBe(false);
});

test("photos are returned with structured-data provenance when available", async () => {
  const result = await sourceListingPhotos(
    { listingUrl: "https://www.zillow.com/homedetails/x/", mls: MLS, address: "1 Main St" },
    stubFetch(
      listingPage({
        jsonLdImages: [
          "https://photos.zillowstatic.com/fp/1.jpg",
          "https://photos.zillowstatic.com/fp/2.jpg",
          "https://photos.zillowstatic.com/fp/3.jpg",
        ],
      }),
    ),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.photos).toHaveLength(3);
  expect(result.photos.every((photo) => photo.provenance === "structured-data")).toBe(true);
  expect(result.photos[0].corroboration).toContain(MLS);
});

test("FAILS CLOSED when the page does not assert the expected MLS number", async () => {
  // This is the regression that put a different building's photo into a live demo: the page
  // had perfectly real property photos, they just were not this property's.
  const result = await sourceListingPhotos(
    { listingUrl: "https://www.zillow.com/homedetails/x/", mls: MLS, address: "1 Main St" },
    stubFetch(
      listingPage({
        mls: "99999999",
        jsonLdImages: [
          "https://photos.zillowstatic.com/fp/1.jpg",
          "https://photos.zillowstatic.com/fp/2.jpg",
          "https://photos.zillowstatic.com/fp/3.jpg",
        ],
      }),
    ),
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain("does not assert MLS");
});

test("off-allowlist hosts are rejected even on a correctly-keyed page", async () => {
  const result = await sourceListingPhotos(
    { listingUrl: "https://www.zillow.com/homedetails/x/", mls: MLS, address: "1 Main St" },
    stubFetch(
      listingPage({
        jsonLdImages: [
          "https://evil.example.com/1.jpg",
          "https://cdn.shopify.com/stock.jpg",
          "https://photos.zillowstatic.com/fp/ok.jpg",
        ],
      }),
    ),
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain("only 1 corroborated photo");
});

test("street view fills the gap only when explicitly allowed, and is labelled", async () => {
  const args = {
    listingUrl: "https://www.zillow.com/homedetails/x/",
    mls: MLS,
    address: "1 Main St, Houston, TX",
    streetViewKey: "test-key",
  };
  const page = listingPage({
    jsonLdImages: [
      "https://photos.zillowstatic.com/fp/1.jpg",
      "https://photos.zillowstatic.com/fp/2.jpg",
    ],
  });

  const denied = await sourceListingPhotos(args, stubFetch(page));
  expect(denied.ok).toBe(false);

  const allowed = await sourceListingPhotos(
    { ...args, allowStreetViewFallback: true },
    stubFetch(page),
  );
  expect(allowed.ok).toBe(true);
  if (!allowed.ok) return;
  expect(allowed.photos[2].provenance).toBe("street-view");
  expect(allowed.photos[2].corroboration).toContain("Street View");
});

test("street view URL never leaks the key into the corroboration string", () => {
  const photo = streetViewPhoto("1 Main St", "super-secret-key");
  expect(photo.url).toContain("super-secret-key");
  expect(photo.corroboration).not.toContain("super-secret-key");
});

test("an unreachable or non-200 listing page yields no photos", async () => {
  const result = await sourceListingPhotos(
    { listingUrl: "https://www.zillow.com/homedetails/x/", mls: MLS, address: "1 Main St" },
    stubFetch("gone", 404),
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain("404");
});

test("duplicate URLs across structured data and markup are not counted twice", async () => {
  const dupe = "https://photos.zillowstatic.com/fp/same.jpg";
  const result = await sourceListingPhotos(
    { listingUrl: "https://www.zillow.com/homedetails/x/", mls: MLS, address: "1 Main St" },
    stubFetch(listingPage({ jsonLdImages: [dupe], imgTags: [dupe, dupe] })),
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toContain("only 1 corroborated photo");
});
