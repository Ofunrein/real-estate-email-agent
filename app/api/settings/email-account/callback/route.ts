import { NextRequest, NextResponse } from "next/server";

import { requireDashboardAuth } from "@/lib/authGuard";
import { clientId } from "@/lib/database";
import { connectGmailAccountFromCode, verifyGmailOAuthState } from "@/lib/gmailConnection";

export const dynamic = "force-dynamic";

function redirectHome(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/", request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session?.user?.email) {
    return redirectHome(request, { emailError: "auth" });
  }

  const code = request.nextUrl.searchParams.get("code") || "";
  const state = request.nextUrl.searchParams.get("state") || "";
  const oauthError = request.nextUrl.searchParams.get("error") || "";
  if (oauthError) return redirectHome(request, { emailError: oauthError });
  if (!code || !state) return redirectHome(request, { emailError: "missing_code" });

  try {
    const verified = verifyGmailOAuthState(state);
    if (verified.clientId !== clientId()) throw new Error("Gmail OAuth client mismatch");
    if (verified.operatorEmail.toLowerCase() !== session.user.email.toLowerCase()) {
      throw new Error("Gmail OAuth operator mismatch");
    }
    const account = await connectGmailAccountFromCode({
      request,
      code,
      connectedBy: session.user.email,
    });
    return redirectHome(request, { emailConnected: account.email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "gmail_connect_failed";
    return redirectHome(request, { emailError: message.slice(0, 120) });
  }
}
