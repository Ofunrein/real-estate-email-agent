import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const DEFAULT_ALLOWED_EMAILS = ["ofunrein123@gmail.com"];

export function getAllowedAuthEmails() {
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

export function authEmailListLabel() {
  return Array.from(getAllowedAuthEmails()).join(", ");
}

const googleClientId = process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") {
        return false;
      }

      const email = profile?.email?.toLowerCase();
      return Boolean(email && profile?.email_verified === true && isAllowedAuthEmail(email));
    },
    authorized({ auth: session, request }) {
      const pathname = request.nextUrl.pathname;

      if (
        pathname === "/login" ||
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
