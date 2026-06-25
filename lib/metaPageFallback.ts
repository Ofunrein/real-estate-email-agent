function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export function configuredMetaPageId(
  channel: "messenger" | "instagram",
  env: Record<string, string | undefined> = process.env,
): string {
  return cleanText(
    channel === "instagram"
      ? env.META_INSTAGRAM_PAGE_ID || env.META_FACEBOOK_PAGE_ID || env.FACEBOOK_PAGE_ID
      : env.META_MESSENGER_PAGE_ID || env.META_FACEBOOK_PAGE_ID || env.FACEBOOK_PAGE_ID,
  );
}
