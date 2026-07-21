import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { configuredWorkspaceEmails, workspaceForConfiguredEmail } from "@/lib/workspace";

const DEFAULT_ALLOWED_EMAILS = ["ofunrein123@gmail.com"];

export function getAllowedAuthEmails() {
  if (process.env.WORKSPACE_EMAIL_MAP) return new Set(configuredWorkspaceEmails());
  const configured = process.env.AUTH_ALLOWED_EMAILS ?? process.env.NEXT_PUBLIC_AUTH_ALLOWED_EMAILS;
  const source = configured
    ? configured
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean)
    : DEFAULT_ALLOWED_EMAILS;

  return new Set(source.map((email) => email.toLowerCase()));
}

export function isAllowedAuthEmail(email?: string | null) {
  return Boolean(email && getAllowedAuthEmails().has(email.toLowerCase()));
}

export function localAuthBypassEnabled() {
  const localBypass = process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_AUTH_BYPASS === "1";
  const previewBypass = process.env.VERCEL_ENV === "preview" && process.env.ALLOW_PREVIEW_AUTH_BYPASS === "1";
  return localBypass || previewBypass;
}

export function authEmailListLabel() {
  return Array.from(getAllowedAuthEmails()).join(", ");
}

const googleClientId = process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

export function hasGoogleAuthProvider() {
  return Boolean(googleClientId && googleClientSecret);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    ...(hasGoogleAuthProvider()
      ? [
          Google({
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          }),
        ]
      : []),
    Credentials({
      id: "credentials",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const { authorizeDashboardPassword } = await import("@/lib/dashboardPasswordAuth");
        const user = await authorizeDashboardPassword(credentials?.email, credentials?.password);
        return user ? { id: user.email, email: user.email, name: user.name } : null;
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "credentials") {
        return true;
      }

      if (account?.provider === "google") {
        const email = profile?.email?.toLowerCase();
        return Boolean(email && profile?.email_verified === true && isAllowedAuthEmail(email) && workspaceForConfiguredEmail(email));
      }

      return false;
    },
    authorized({ auth: session, request }) {
      const pathname = request.nextUrl.pathname;

      if (localAuthBypassEnabled()) {
        return true;
      }

      if (
        pathname === "/login" ||
        pathname === "/reset-password" ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/webhooks") ||
        pathname.startsWith("/api/cron")
      ) {
        return true;
      }

      return Boolean(session?.user?.email && isAllowedAuthEmail(session.user.email));
    },
  },
});
