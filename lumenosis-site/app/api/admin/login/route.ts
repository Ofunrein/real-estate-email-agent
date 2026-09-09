import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminCookieValue, validAdminPassword } from "@/lib/admin-auth";
import { allowRequest, clientAddress } from "@/lib/demo-rate-limit";

export async function POST(request: NextRequest) {
  if (!allowRequest(`admin-login:${clientAddress(request.headers)}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!validAdminPassword(password)) {
    return NextResponse.redirect(new URL("/admin/demos/login?error=1", request.url), 303);
  }
  const response = NextResponse.redirect(new URL("/admin/demos", request.url), 303);
  response.cookies.set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
  return response;
}
