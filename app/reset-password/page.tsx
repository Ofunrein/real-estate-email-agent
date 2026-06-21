import { redirect } from "next/navigation";

import { auth, localAuthBypassEnabled } from "@/auth";
import { resetPasswordAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ email?: string; token?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.email || localAuthBypassEnabled()) {
    redirect("/");
  }

  const params = await searchParams;
  const email = params?.email || "";
  const token = params?.token || "";
  const error = params?.error || "";

  return (
    <main className="login-shell">
      <section className="login-panel reset-panel" aria-labelledby="reset-title">
        <span className="login-eyebrow">Secure reset</span>
        <h1 id="reset-title">Create a new password</h1>
        <p>Use the reset link from your email. Only approved workspace emails can set a password.</p>

        {error === "mismatch" ? <p className="login-alert">Passwords do not match.</p> : null}
        {error === "policy" ? <p className="login-alert">Use at least 10 characters.</p> : null}
        {error === "invalid" ? <p className="login-alert">This reset link is invalid or expired.</p> : null}

        <form action={resetPasswordAction} className="login-form">
          <input name="email" type="hidden" value={email} />
          <input name="token" type="hidden" value={token} />
          <label>
            <span>Email</span>
            <input type="email" value={email} readOnly />
          </label>
          <label>
            <span>New password</span>
            <input name="password" type="password" autoComplete="new-password" required minLength={10} />
          </label>
          <label>
            <span>Confirm password</span>
            <input name="confirm" type="password" autoComplete="new-password" required minLength={10} />
          </label>
          <button className="login-button" type="submit" disabled={!email || !token}>
            Reset password
          </button>
        </form>
      </section>
    </main>
  );
}
