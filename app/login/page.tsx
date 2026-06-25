import { redirect } from "next/navigation";
import type { CSSProperties } from "react";

import { auth, localAuthBypassEnabled } from "@/auth";
import { passwordSignInEnabled } from "@/lib/dashboardPasswordAuth";
import { requestPasswordReset, signInWithPassword } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; reset?: string; devReset?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;

  if (session?.user?.email || localAuthBypassEnabled()) {
    redirect("/");
  }

  const error = params?.error || "";
  const reset = params?.reset || "";
  const devReset = params?.devReset || "";
  const passwordEnabled = passwordSignInEnabled();

  return (
    <main className="login-shell">
      <section className="login-panel login-panel-compact" aria-labelledby="login-title">
        <div className="login-form-card login-auth-card login-auth-card-single">
          <div className="login-auth-graphic">
            <div className="login-ripple-field" aria-hidden="true">
              {Array.from({ length: 9 }, (_, index) => (
                <span key={index} style={{ "--i": index } as CSSProperties} />
              ))}
            </div>
            <div className="login-tech-orbit" aria-hidden="true">
              <span className="login-orbit-word">Iris</span>
              <span className="login-orbit-chip login-orbit-chip-one">CRM</span>
              <span className="login-orbit-chip login-orbit-chip-two">SMS</span>
              <span className="login-orbit-chip login-orbit-chip-three">Voice</span>
              <span className="login-orbit-chip login-orbit-chip-four">Gmail</span>
            </div>
            <div className="login-brand-copy">
              <h1 id="login-title">Iris Front Desk</h1>
              <p>
                One operating layer for approved teams to monitor leads, review drafts,
                and keep every real estate conversation moving.
              </p>
            </div>
          </div>

          {error ? (
            <p className="login-alert">
              Sign-in failed. Use an approved email or reset your password.
            </p>
          ) : null}

          {reset === "sent" ? (
            <p className="login-success">
              If that email is approved, a reset link was sent.
              {devReset ? (
                <>
                  {" "}
                  Local reset link: <a href={devReset}>open reset</a>
                </>
              ) : null}
            </p>
          ) : null}

          {reset === "complete" ? (
            <p className="login-success">
              Password updated. Sign in with your email and new password.
            </p>
          ) : null}

          {reset === "error" ? (
            <p className="login-alert">
              Password reset email could not be sent. Check the connected Iris mailbox.
            </p>
          ) : null}

          <form action={signInWithPassword} className="login-form">
            <label>
              <span>Email</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                required
                disabled={!passwordEnabled}
              />
            </label>
            <label>
              <span className="login-label-row">
                Password
                <button
                  className="login-forgot-link"
                  formAction={requestPasswordReset}
                  type="submit"
                  disabled={!passwordEnabled}
                  formNoValidate
                >
                  Forgot password?
                </button>
              </span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Dashboard password"
                required
                disabled={!passwordEnabled}
              />
            </label>
            <button className="login-button" type="submit" disabled={!passwordEnabled}>
              Sign in
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
