import { NextRequest, NextResponse } from "next/server";

const COMPOSIO_CALLBACK = "https://backend.composio.dev/api/v1/auth-apps/add";

export function GET(request: NextRequest) {
  const callback = new URL(COMPOSIO_CALLBACK);
  callback.search = request.nextUrl.search;
  return NextResponse.redirect(callback);
}
