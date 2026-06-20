import { NextResponse } from "next/server";

import { auth, isAllowedAuthEmail } from "@/auth";

export async function requireDashboardAuth() {
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
