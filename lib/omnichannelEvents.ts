import type { Channel } from "@/lib/inboxData";

export type OmnichannelMedia = {
  id?: string;
  url?: string;
  type?: "audio" | "video" | "image" | "file" | "unknown";
  contentType?: string;
  filename?: string;
  transcript?: string;
  providerMetadata?: Record<string, unknown>;
};

export type OmnichannelMessageReceived = {
  clientId?: string;
  channel: Channel;
  provider: string;
  providerMessageId: string;
  threadRef: string;
  contactRef?: string;
  direction?: "inbound" | "outbound";
  text?: string;
  media?: OmnichannelMedia[];
  receivedAt?: string;
  providerMetadata?: Record<string, unknown>;
};

const CHANNEL_PREFIX: Partial<Record<Channel, string>> = {
  email: "gmail",
  sms: "twilio",
  instagram: "instagram",
  messenger: "facebook",
  whatsapp: "whatsapp",
  voice: "vapi",
};

export function normalizedDedupeKey(input: Pick<OmnichannelMessageReceived, "channel" | "provider" | "providerMessageId" | "threadRef">): string {
  const providerMessageId = String(input.providerMessageId || "").trim();
  const fallback = String(input.threadRef || "").trim();
  const id = providerMessageId || fallback;
  const provider = String(input.provider || "").trim().toLowerCase();
  const prefix = provider || CHANNEL_PREFIX[input.channel] || input.channel;
  return `${prefix}:${id}`;
}

export function mediaTranscriptLines(media: OmnichannelMedia[] = []): string[] {
  return media
    .map((item) => {
      const transcript = String(item.transcript || "").trim();
      if (!transcript) return "";
      const label = item.type === "video" ? "Video note transcript" : "Voice note transcript";
      return `${label}: ${transcript}`;
    })
    .filter(Boolean);
}

export function normalizedMessageText(input: Pick<OmnichannelMessageReceived, "text" | "media">): string {
  const text = String(input.text || "").trim();
  const mediaLines = mediaTranscriptLines(input.media);
  const attachmentLine = !text && !mediaLines.length && input.media?.length ? "Attachment" : "";
  return [text, ...mediaLines, attachmentLine].filter(Boolean).join("\n\n");
}

export function isMediaTranscribable(media: Pick<OmnichannelMedia, "type" | "contentType" | "url" | "filename">): boolean {
  const contentType = String(media.contentType || "").toLowerCase();
  const filename = String(media.filename || media.url || "").toLowerCase();
  if (media.type === "audio" || media.type === "video") return true;
  if (contentType.startsWith("audio/") || contentType.startsWith("video/")) return true;
  return /\.(?:aac|m4a|mp3|mp4|mpeg|oga|ogg|opus|wav|webm|mov)(?:$|[?#])/i.test(filename);
}

export function mediaLogLines(media: OmnichannelMedia[] = []): string[] {
  return media.flatMap((item) => {
    const url = String(item.url || "").trim();
    const label = item.type === "image"
      ? "Image"
      : item.type === "audio"
        ? "Voice note"
        : item.type === "video"
          ? "Video"
          : "Attachment";
    return [
      url ? `${label}: ${url}` : "",
      ...mediaTranscriptLines([item]),
    ].filter(Boolean);
  });
}
