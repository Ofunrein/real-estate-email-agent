import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { reserveDemoGeneration } from "@/lib/demo-budget";
import { demoRoomForToken } from "@/lib/demo-room";
import {
  fairHousingDemoReply,
  IRIS_DEMO_MODEL,
  irisDemoSystemPrompt,
  validIrisDemoReply,
} from "@/lib/iris-demo-policy";

export const dynamic = "force-dynamic";

const Input = z.object({ message: z.string().trim().min(2).max(1200) });
const Output = z.object({
  subject: z.string().min(1),
  reply: z.string().min(1),
  captured: z.array(z.string()).max(8),
  nextAction: z.string().min(1),
});

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const allowDraft = await isAdmin();
  const match = await demoRoomForToken(token, allowDraft);
  if (!match) return NextResponse.json({ error: "Demo not found" }, { status: 404 });
  if (match.expired) return NextResponse.json({ error: "Demo expired" }, { status: 410 });

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid inquiry" }, { status: 400 });

  const protectedReply = fairHousingDemoReply(parsed.data.message, match.room.prospect.firstName);
  if (protectedReply)
    return NextResponse.json(protectedReply, { headers: { "Cache-Control": "no-store" } });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Email demo is not configured" }, { status: 503 });

  if (!(await reserveDemoGeneration(match.id, token, allowDraft))) {
    return NextResponse.json({ error: "Demo usage limit reached" }, { status: 429 });
  }

  const { room } = match;
  const knowledge = [
    `Business: ${room.prospect.businessName}`,
    `Listing status: ${room.listing.status}`,
    `Address: ${room.listing.address}`,
    `Price: $${room.listing.price.toLocaleString("en-US")}`,
    `Bedrooms: ${room.listing.beds}`,
    `Bathrooms: ${room.listing.baths}`,
    `Square feet: ${room.listing.squareFeet}`,
    `Acreage: ${room.listing.acreage}`,
    `MLS: ${room.listing.mls}`,
    `Property type: ${room.listing.propertyType}`,
    `Year built: ${room.listing.yearBuilt}`,
    `Lot square feet: ${room.listing.lotSquareFeet}`,
    `Price per square foot: $${room.listing.pricePerSquareFoot}`,
    `Listed: ${room.listing.listedAt}`,
    `Summary: ${room.listing.summary}`,
    `Highlights: ${room.listing.highlights.join("; ")}`,
    `Buyer notes: ${room.listing.buyerNotes.join("; ")}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: ["Bearer", apiKey].join(" "), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IRIS_DEMO_MODEL,
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "iris_demo_reply",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              subject: { type: "string", description: "Concise factual email subject" },
              reply: { type: "string", description: "Buyer-facing email body, 90-180 words" },
              captured: {
                type: "array",
                maxItems: 8,
                items: {
                  type: "string",
                  description:
                    "A buyer detail, preference, constraint, or timeline explicitly stated in the inquiry; never a listing fact or question",
                },
              },
              nextAction: {
                type: "string",
                description: "Specific private next-action note for the agent",
              },
            },
            required: ["subject", "reply", "captured", "nextAction"],
          },
        },
      },
      messages: [
        {
          role: "system",
          content: irisDemoSystemPrompt(room, knowledge),
        },
        { role: "user", content: parsed.data.message },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("[demo-email] OpenAI request failed", {
      status: response.status,
      detail: detail.slice(0, 300),
    });
    return NextResponse.json({ error: "Iris is temporarily unavailable" }, { status: 502 });
  }
  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content;
  let decoded: unknown = null;
  try {
    decoded = typeof text === "string" ? JSON.parse(text) : null;
  } catch {
    decoded = null;
  }
  const result = Output.safeParse(decoded);
  if (!result.success)
    return NextResponse.json({ error: "Iris returned an invalid response" }, { status: 502 });
  if (!validIrisDemoReply(result.data.reply, room.prospect.firstName))
    return NextResponse.json({ error: "Iris returned an unsafe response" }, { status: 502 });

  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
