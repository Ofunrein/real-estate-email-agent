import { serve } from "inngest/next";
import { NextRequest, NextResponse } from "next/server";

import { inngest } from "@/lib/inngest/client";
import { composioSocialMinutePoll } from "@/lib/inngest/functions/composioSocialMinutePoll";
import { irisEmailMinutePoll } from "@/lib/inngest/functions/irisEmailMinutePoll";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const inngestHandler = serve({
  client: inngest,
  functions: [irisEmailMinutePoll, composioSocialMinutePoll],
});

function missingSigningKeyResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "INNGEST_SIGNING_KEY is required before Inngest Cloud can register or invoke functions.",
    },
    { status: 503 },
  );
}

function canServeInngest(): boolean {
  return process.env.NODE_ENV !== "production" || Boolean(process.env.INNGEST_SIGNING_KEY);
}

export const GET = (request: NextRequest, context: unknown) => {
  return canServeInngest() ? inngestHandler.GET(request, context) : Promise.resolve(missingSigningKeyResponse());
};

export const POST = (request: NextRequest, context: unknown) => {
  return canServeInngest() ? inngestHandler.POST(request, context) : Promise.resolve(missingSigningKeyResponse());
};

export const PUT = (request: NextRequest, context: unknown) => {
  return canServeInngest() ? inngestHandler.PUT(request, context) : Promise.resolve(missingSigningKeyResponse());
};
