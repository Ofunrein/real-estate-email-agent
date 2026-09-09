import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { DemoRoom } from "@/content/demo-rooms";
import { isAdmin } from "@/lib/admin-auth";
import { tokenHash } from "@/lib/demo-room";
import { verifyListingImages } from "@/lib/listing-image-qa";
import { sourceListingPhotos } from "@/lib/listing-photo-source";
import { sql } from "@/lib/turso";

const Input = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  businessName: z.string().trim().min(2).max(150),
  listingAddress: z.string().trim().min(8).max(200),
  listingUrl: z.string().url(),
  senderInbox: z.enum([
    "iris-demo@agentmail.to",
    "iris-outreach@agentmail.to",
    "olivia-outreach@agentmail.to",
    "aria-outreach@agentmail.to",
  ]),
});

const Listing = z
  .object({
    status: z.literal("active"),
    price: z.number().int().positive(),
    beds: z.number().nonnegative(),
    baths: z.number().nonnegative(),
    squareFeet: z.number().int().positive(),
    acreage: z.number().nonnegative(),
    mls: z.string().min(1),
    propertyType: z.string().min(1),
    yearBuilt: z.number().int().min(0).max(2100),
    lotSquareFeet: z.number().int().nonnegative(),
    pricePerSquareFoot: z.number().int().nonnegative(),
    listedAt: z.string().min(1),
    summary: z.string().min(30),
    highlights: z.array(z.string()).min(3).max(8),
    buyerNotes: z.array(z.string()).max(6),
  })
  .refine((l) => l.price >= 25000, { message: "price looks like a rent amount, not a sale price" })
  .refine((l) => !/lease|rent/i.test(l.propertyType), {
    message: "listing is a lease, not for sale",
  });

const senderNames: Record<string, string> = {
  "iris-demo@agentmail.to": "Iris",
  "iris-outreach@agentmail.to": "Iris",
  "olivia-outreach@agentmail.to": "Olivia",
  "aria-outreach@agentmail.to": "Aria",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Input.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return NextResponse.json({ error: "Invalid prospect" }, { status: 400 });
  const input = parsed.data;
  const tavilyKey = process.env.TAVILY_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!tavilyKey || !openaiKey)
    return NextResponse.json({ error: "Research is not configured" }, { status: 503 });

  const researchResponse = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyKey,
      query: `Verify active real estate listing ${input.listingAddress} ${input.listingUrl}`,
      include_raw_content: true,
      include_images: true,
      max_results: 6,
      search_depth: "advanced",
    }),
  });
  if (!researchResponse.ok) return NextResponse.json({ error: "Research failed" }, { status: 502 });
  const research = await researchResponse.json();

  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "listing",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              status: { type: "string", enum: ["active"] },
              price: { type: "integer" },
              beds: { type: "number" },
              baths: { type: "number" },
              squareFeet: { type: "integer" },
              acreage: { type: "number" },
              mls: { type: "string" },
              propertyType: { type: "string" },
              yearBuilt: { type: "integer" },
              lotSquareFeet: { type: "integer" },
              pricePerSquareFoot: { type: "integer" },
              listedAt: { type: "string" },
              summary: { type: "string" },
              highlights: { type: "array", items: { type: "string" } },
              buyerNotes: { type: "array", items: { type: "string" } },
            },
            required: [
              "status",
              "price",
              "beds",
              "baths",
              "squareFeet",
              "acreage",
              "mls",
              "propertyType",
              "yearBuilt",
              "lotSquareFeet",
              "pricePerSquareFoot",
              "listedAt",
              "summary",
              "highlights",
              "buyerNotes",
            ],
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "Extract only verified facts for the exact listing. The listing must be currently for sale and active; never use a lease, rental, or off-market record, and never mix facts from a different listing, unit, or past sale of the same address. Use 0 for unavailable numeric facts. Never infer. Do not return image URLs: photos are retrieved separately from the listing page and any URL you produce would be an invented string.",
        },
        {
          role: "user",
          content: JSON.stringify({
            address: input.listingAddress,
            source: input.listingUrl,
            research,
          }),
        },
      ],
    }),
  });
  if (!aiResponse.ok)
    return NextResponse.json({ error: "Listing extraction failed" }, { status: 502 });
  const ai = await aiResponse.json();
  const extracted = JSON.parse(ai.choices?.[0]?.message?.content ?? "null");
  if (extracted && typeof extracted === "object") {
    if (Array.isArray(extracted.highlights))
      extracted.highlights = extracted.highlights.slice(0, 8);
    if (Array.isArray(extracted.buyerNotes))
      extracted.buyerNotes = extracted.buyerNotes.slice(0, 6);
    // Any imageUrls the model volunteers despite the schema are discarded outright rather
    // than filtered: photos come only from sourceListingPhotos below.
    delete extracted.imageUrls;
  }
  const listing = Listing.safeParse(extracted);
  if (!listing.success)
    return NextResponse.json(
      {
        error: "Listing could not be verified as an active for-sale listing",
        fields: listing.error.issues.map((issue) => issue.path.join(".") || issue.message),
      },
      { status: 422 },
    );

  // Photos are RETRIEVED, never generated. The model above no longer returns image URLs:
  // asking an LLM to emit a CDN path is asking it to produce a plausible string, and a
  // plausible Zillow path frequently belongs to a different property — that is exactly how a
  // neighbouring building's photo reached a live demo. Instead we fetch the listing page,
  // require it to actually assert this MLS number, and take only photos that page carries.
  const sourced = await sourceListingPhotos({
    listingUrl: input.listingUrl,
    mls: listing.data.mls,
    address: input.listingAddress,
    streetViewKey: process.env.GOOGLE_STREET_VIEW_API_KEY,
    allowStreetViewFallback: true,
  });
  if (!sourced.ok)
    return NextResponse.json(
      { error: "Listing photos could not be verified", reason: sourced.reason },
      { status: 422 },
    );
  const imageUrls = sourced.photos.map((photo) => photo.url);

  // Vision QA still runs, but it is now the second gate rather than the only one. It can
  // catch a logo or floor plan that slipped through the markup; it cannot be expected to
  // catch a real photo of the wrong house, which is why provenance above does that job.
  const imageQa = await verifyListingImages(
    input.listingAddress,
    input.listingUrl,
    imageUrls,
    openaiKey,
  );
  if (!imageQa.passed)
    return NextResponse.json(
      {
        error: "Listing images failed QA",
        images: imageQa.assessments.map(({ url, reason }) => ({ url, reason })),
      },
      { status: 422 },
    );

  const firstName = input.fullName.split(/\s+/)[0];
  const id = randomUUID();
  const prospectId = randomUUID();
  const listingId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const slug = `${slugify(input.fullName)}-${slugify(input.listingAddress)}-${id.slice(0, 8)}`;
  const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
  const facts = listing.data;
  if (!facts.buyerNotes.length) {
    facts.buyerNotes = [
      "Showing availability and unverified property details require human confirmation",
    ];
  }
  const room: DemoRoom = {
    slug,
    prospect: {
      firstName,
      fullName: input.fullName,
      businessName: input.businessName,
      role: "REALTOR®",
    },
    listing: {
      address: input.listingAddress,
      ...facts,
      images: imageUrls.map((src, index) => ({
        src,
        alt: `${input.listingAddress} listing photo ${index + 1}`,
      })),
    },
    sources: [
      {
        label: "Primary active listing",
        url: input.listingUrl,
        checkedAt: new Date().toISOString().slice(0, 10),
      },
    ],
    qa: {
      passed: true,
      checkedAt: new Date().toISOString(),
      images: "exact-listing-property-photos",
      responsiveViewports: [320, 390, 768, 1024, 1440],
    },
    expiresAt,
    approved: false,
  };
  const senderName = senderNames[input.senderInbox];
  const demoUrl = `https://lumenosis.com/demo/${token}`;
  const subject = "I built you an AI agent to try for free";
  const body = `Hi ${firstName},\n\nMy name is ${senderName}. I’m an AI consultant, and I help businesses implement AI solutions to save time, improve operations, and generate more revenue.\n\nI put together a [private AI demo for ${input.businessName}](${demoUrl}) built around your listing at ${input.listingAddress}. You can try the voice and email agent completely free, and you can [learn more about what we do here](https://lumenosis.com).\n\nNo pressure. I thought it could be useful for your business and wanted to let you try it.\n\nIf you want to see how we would set it up, reply yes and I’ll send the next step.\n\nBest,\n${senderName}`;

  await sql(
    "INSERT INTO prospects (id, full_name, first_name, email, business_name, sender_inbox) VALUES (?, ?, ?, ?, ?, ?)",
    [prospectId, input.fullName, firstName, input.email, input.businessName, input.senderInbox],
  );
  await sql(
    "INSERT INTO listings (id, prospect_id, address, source_url, status, price, beds, baths, square_feet, acreage, mls, details_json, sources_json, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      listingId,
      prospectId,
      input.listingAddress,
      input.listingUrl,
      facts.status,
      facts.price,
      facts.beds,
      facts.baths,
      facts.squareFeet,
      facts.acreage,
      facts.mls,
      JSON.stringify(facts),
      JSON.stringify(room.sources),
      new Date().toISOString(),
    ],
  );
  await sql(
    "INSERT INTO demo_rooms (id, prospect_id, listing_id, slug, token_hash, access_token, config_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, prospectId, listingId, slug, tokenHash(token), token, JSON.stringify(room), expiresAt],
  );
  await sql(
    "INSERT INTO outreach_drafts (id, demo_room_id, sender_name, sender_inbox, recipient, subject, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), id, senderName, input.senderInbox, input.email, subject, body],
  );
  return NextResponse.redirect(new URL("/admin/demos", request.url), 303);
}
