import { serve } from "inngest/next";
import { NextRequest, NextResponse } from "next/server";

import { inngest } from "@/lib/inngest/client";
import { messageReceived } from "@/lib/inngest/functions/messageReceived";
import { messageReplyGenerate } from "@/lib/inngest/functions/messageReplyGenerate";
import { messageReplySend } from "@/lib/inngest/functions/messageReplySend";
import { sheetsChangedSync } from "@/lib/inngest/functions/sheetsChangedSync";
import { threadSummaryRefresh } from "@/lib/inngest/functions/threadSummaryRefresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const inngestHandler = serve({
  client: inngest,
  functions: [
    messageReceived,
    messageReplyGenerate,
    messageReplySend,
    sheetsChangedSync,
    threadSummaryRefresh,
  ],
});

const inngestAppId = "lumenosis-real-estate-agent";

const activeRawInngestFunctionIds = [
  "message-received",
  "message-reply-generate",
  "message-reply-send",
  "sheets-changed-sync",
  "thread-summary-refresh",
];

const retiredRawInngestFunctionIds = [
  "composio-social-minute-poll",
  "iris-email-minute-poll",
];

const activeInngestFunctionIds = new Set([
  ...activeRawInngestFunctionIds,
  ...activeRawInngestFunctionIds.map((id) => `${inngestAppId}-${id}`),
]);

const retiredInngestFunctionIds = new Set([
  ...retiredRawInngestFunctionIds,
  ...retiredRawInngestFunctionIds.map((id) => `${inngestAppId}-${id}`),
]);

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

function staleFunctionResponse(fnId: string) {
  const retired = retiredInngestFunctionIds.has(fnId);
  console.warn("[inngest] skipped stale function invocation", {
    fnId,
    retired,
    reason: retired ? "retired_polling_function" : "unknown_function_id",
  });
  return NextResponse.json(
    {
      ok: true,
      skipped: retired ? "retired_polling_function" : "unknown_function_id",
      fnId,
    },
    { headers: { "x-inngest-sdk-handled": "true" } },
  );
}

function maybeStaleFunctionInvocation(request: NextRequest) {
  const fnId = request.nextUrl.searchParams.get("fnId")?.trim();
  if (!fnId || activeInngestFunctionIds.has(fnId)) return null;
  return staleFunctionResponse(fnId);
}

export const GET = (request: NextRequest, context: unknown) => {
  return canServeInngest() ? inngestHandler.GET(request, context) : Promise.resolve(missingSigningKeyResponse());
};

export const POST = (request: NextRequest, context: unknown) => {
  if (!canServeInngest()) return Promise.resolve(missingSigningKeyResponse());
  const staleResponse = maybeStaleFunctionInvocation(request);
  if (staleResponse) return Promise.resolve(staleResponse);
  return inngestHandler.POST(request, context);
};

export const PUT = (request: NextRequest, context: unknown) => {
  return canServeInngest() ? inngestHandler.PUT(request, context) : Promise.resolve(missingSigningKeyResponse());
};
