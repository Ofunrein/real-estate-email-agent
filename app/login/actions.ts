"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { requestDashboardPasswordReset } from "@/lib/dashboardPasswordAuth";

export async function signInWithPassword(formData: FormData) {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") || ""),
      password: String(formData.get("password") || ""),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=CredentialsSignin");
    }
    throw error;
  }
}

export async function requestPasswordReset(formData: FormData) {
  try {
    const result = await requestDashboardPasswordReset(formData.get("resetEmail"));
    const params = new URLSearchParams({ reset: "sent" });
    if (result.devResetUrl) params.set("devReset", result.devResetUrl);
    redirect(`/login?${params.toString()}`);
  } catch {
    redirect("/login?reset=error");
  }
}
