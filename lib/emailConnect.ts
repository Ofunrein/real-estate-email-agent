export type EmailOAuthProvider = "gmail" | "outlook";

export function emailConnectPath(provider: EmailOAuthProvider): string {
  return provider === "outlook"
    ? "/api/settings/email-account/outlook-connect"
    : "/api/settings/email-account/connect";
}
