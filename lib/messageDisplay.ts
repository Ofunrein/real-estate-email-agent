// How a stored message body becomes readable text in the dashboard.
//
// Why this module exists: the inbox rendered every plain-text body through a helper that ran
// `.replace(/\s+/g, " ")`. That is the same class of bug lib/smsFormatting.ts was written
// against, one layer later - the outbound serializer spends blank lines deliberately to give a
// URL its own paragraph, and the dashboard then flattened the whole thing back into one line.
// SMS, iMessage, WhatsApp, RCS, social DMs and website chat all read as a wall because of it.
//
// Everything here is pure and provider-neutral so tests/ts/messageDisplay.test.ts can assert on
// it directly, and so every channel view inherits the same contract instead of re-deriving it.

/** Text channels render stored newlines. Voice transcripts and email HTML do not go through here. */
const TEXT_MESSAGE_CHANNELS = new Set([
  "sms",
  "rcs",
  "imessage",
  "whatsapp",
  "instagram",
  "messenger",
  "social",
  "web",
  "website",
  "website_chat",
]);

export function isTextMessageChannel(channel: string): boolean {
  return TEXT_MESSAGE_CHANNELS.has(String(channel || "").trim().toLowerCase());
}

/**
 * Plain-text body exactly as it should render, with its paragraph structure intact.
 *
 * - Newlines and blank lines survive. They are the only structural tool a text channel has, and
 *   the outbound serializer already spent them deliberately.
 * - Horizontal whitespace inside a line still collapses, so a stray double space does not show.
 * - Markup is stripped to text, never handed to a renderer. The return value is a React text
 *   child, so there is no HTML injection path even if a body arrives full of tags.
 */
export function messageDisplayText(value = "", fallback = ""): string {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    // Block-level markup that arrived inside a plain-text body becomes the break it stood for.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    // Ampersand last, so "&amp;lt;" cannot decode twice into a tag.
    .replace(/&amp;/gi, "&")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    // One blank line is a paragraph break. Three newlines is a rendering artifact.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || fallback;
}

/**
 * Single-line summary for thread lists, previews and activity rows, where the row is one line
 * tall and a newline would just become a clipped gap. Collapsing here is deliberate; collapsing
 * in a message bubble is the bug.
 */
export function messagePreviewText(value = "", fallback = "No message yet"): string {
  const text = messageDisplayText(value).replace(/\s+/g, " ").trim();
  return text || fallback;
}

/**
 * Class for the plain-text branch of a message bubble. `pre-wrap` is what makes the preserved
 * newlines visible; without it the browser collapses them right back to spaces and the fix above
 * is invisible. Kept here so the view and its regression test agree on one name.
 */
export const MESSAGE_TEXT_CLASS = "iris-bubble-text";

export function messageBubbleClassName(hasHtml: boolean): string {
  return hasHtml ? "iris-bubble has-html" : `iris-bubble ${MESSAGE_TEXT_CLASS}`;
}
