import { redirect } from "next/navigation";

import { auth, authEmailListLabel, signIn } from "@/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;

  if (session?.user?.email) {
    redirect("/");
  }

  const hasError = Boolean(params?.error);

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <span className="login-eyebrow">Lumenosis AI</span>
          <h1 id="login-title">Sign in to Iris</h1>
          <p>
            Access is limited to approved operators. Use the Google account on the Iris
            allowlist.
          </p>
        </div>

        {hasError ? (
          <p className="login-alert">
            That Google account is not approved for this workspace. Approved users:
            {" "}
            {authEmailListLabel()}
          </p>
        ) : null}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button className="login-button" type="submit">
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}
