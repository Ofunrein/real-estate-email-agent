import { NextResponse } from "next/server";

import { auth, isAllowedAuthEmail, localAuthBypassEnabled } from "@/auth";

export async function requireDashboardAuth() {
  if (localAuthBypassEnabled()) {
    return { user: { email: "local-dev@lumenosis.test" } };
  }

  const session = await auth();
  const email = session?.user?.email;

  if (!isAllowedAuthEmail(email)) {
    return null;
  }

  return session;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}
