import { redirect } from "next/navigation";
import type { CSSProperties } from "react";

import { auth, hasGoogleAuthProvider, localAuthBypassEnabled, signIn } from "@/auth";
import { passwordSignInEnabled } from "@/lib/dashboardPasswordAuth";
import { requestPasswordReset, signInWithPassword } from "./actions";

export const dynamic = "force-dynamic";

function GoogleMark() {
  return (
    <svg className="login-google-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

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
  const googleEnabled = hasGoogleAuthProvider();

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
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Dashboard password"
                required
                disabled={!passwordEnabled}
              />
            </label>
            <div className="login-forgot-row">
              <button
                className="login-forgot-link"
                formAction={requestPasswordReset}
                type="submit"
                disabled={!passwordEnabled}
                formNoValidate
              >
                Forgot password?
              </button>
            </div>
            <button className="login-button" type="submit" disabled={!passwordEnabled}>
              Sign in
            </button>
          </form>

          <div className="login-divider"><span>or</span></div>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/" });
            }}
          >
            <button className="login-button login-button-secondary" type="submit" disabled={!googleEnabled}>
              <GoogleMark />
              <span>Continue with Google</span>
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
