import { redirect } from "next/navigation";

import { auth, authEmailListLabel, hasGoogleAuthProvider, localAuthBypassEnabled, signIn } from "@/auth";
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
  const googleEnabled = hasGoogleAuthProvider();
  const passwordEnabled = passwordSignInEnabled();

  return (
    <main className="login-shell">
      <section className="login-panel login-panel-auth" aria-labelledby="login-title">
        <div className="login-form-card login-auth-card">
          <div className="login-orbit" aria-hidden="true">
            <span className="login-ripple login-ripple-one" />
            <span className="login-ripple login-ripple-two" />
            <span className="login-orbit-ring login-orbit-ring-one">
              <span />
            </span>
            <span className="login-orbit-ring login-orbit-ring-two">
              <span />
            </span>
            <div className="login-iris-mark">Iris</div>
          </div>
          <div>
            <span className="login-eyebrow login-box-reveal">Lumenosis AI</span>
            <h1 id="login-title" className="login-box-reveal login-box-reveal-delay">Iris command center</h1>
            <p className="login-box-reveal login-box-reveal-late">
              Authorized operators can sign in with Google or email password.
            </p>
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

          <form action={requestPasswordReset} className="login-reset-form">
            <label>
              <span>Reset password by email</span>
              <input
                name="resetEmail"
                type="email"
                autoComplete="email"
                placeholder="approved@email.com"
                required
                disabled={!passwordEnabled}
              />
            </label>
            <button className="login-link-button" type="submit" disabled={!passwordEnabled}>
              Email reset link
            </button>
          </form>

          <p className="login-allowlist">Allowlist: {authEmailListLabel()}</p>
        </div>
      </section>
    </main>
  );
}
