import { type NextRequest, NextResponse } from "next/server";

type Lead = {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  score?: string | number;
  result?: string;
};

function value(payload: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const item = payload[name];
    if (typeof item === "string" || typeof item === "number") return item;
  }
}

function leadFrom(payload: Record<string, unknown>): Lead {
  const fields = [payload, payload.data, payload.submission].filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
  const merged = Object.assign({}, ...fields);

  return {
    email: String(value(merged, ["email", "Email"]) ?? "").trim() || undefined,
    firstName: String(value(merged, ["firstName", "first_name", "First Name"]) ?? "").trim() || undefined,
    lastName: String(value(merged, ["lastName", "last_name", "Last Name"]) ?? "").trim() || undefined,
    phone: String(value(merged, ["phone", "Phone", "phoneNumber"]) ?? "").trim() || undefined,
    score: value(merged, ["score", "Score", "quizScore", "quiz_score"]),
    result: String(value(merged, ["result", "Result", "resultBand", "result_band"]) ?? "").trim() || undefined,
  };
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function createMauticContact(lead: Lead) {
  const baseUrl = process.env.MAUTIC_BASE_URL?.replace(/\/$/, "");
  const username = process.env.MAUTIC_USERNAME;
  const password = process.env.MAUTIC_PASSWORD;
  if (!baseUrl || !username || !password || !lead.email) return;

  const tags = ["quiz"];
  if (lead.result) tags.push(`quiz-result-${slug(lead.result)}`);
  if (lead.score !== undefined) tags.push(`quiz-score-${lead.score}`);

  const response = await fetch(`${baseUrl}/api/contacts/new`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: lead.email,
      firstname: lead.firstName,
      lastname: lead.lastName,
      mobile: lead.phone,
      tags,
    }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Mautic contact request failed: ${response.status}`);
}

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const signature = req.headers.get("x-fillout-signature") ?? req.headers.get("x-webhook-signature");
  if (process.env.NODE_ENV === "production" && !signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 });
  }

  const lead = leadFrom(payload as Record<string, unknown>);
  try {
    await createMauticContact(lead);
  } catch (error) {
    console.error("[lead] Mautic forward failed", error);
    return NextResponse.json({ error: "automation unavailable" }, { status: 502 });
  }

  console.log("[lead] received", { ts: new Date().toISOString(), email: lead.email, score: lead.score });
  return NextResponse.json({ ok: true });
}
