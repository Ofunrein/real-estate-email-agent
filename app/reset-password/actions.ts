"use server";

import { redirect } from "next/navigation";

import { resetDashboardPassword } from "@/lib/dashboardPasswordAuth";

export async function resetPasswordAction(formData: FormData) {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (password !== confirm) {
    redirect(`/reset-password?email=${encodeURIComponent(String(formData.get("email") || ""))}&token=${encodeURIComponent(String(formData.get("token") || ""))}&error=mismatch`);
  }

  try {
    await resetDashboardPassword({
      email: formData.get("email"),
      token: formData.get("token"),
      password,
    });
    redirect("/login?reset=complete");
  } catch (error) {
    const reason = error instanceof Error && /character/i.test(error.message) ? "policy" : "invalid";
    redirect(`/reset-password?email=${encodeURIComponent(String(formData.get("email") || ""))}&token=${encodeURIComponent(String(formData.get("token") || ""))}&error=${reason}`);
  }
}
