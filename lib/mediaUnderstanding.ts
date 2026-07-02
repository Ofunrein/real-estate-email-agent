import type { OmnichannelMedia } from "@/lib/omnichannelEvents";

type MediaContext = {
  mediaType: string;
  summary: string;
  extractedText?: string;
  confidence: number;
  needsHuman: boolean;
  model: string;
};

type AnthropicVisionResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

const MAX_VISION_BYTES = 4_500_000;

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

function envFlag(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function anthropicKey(): string {
  return process.env.ANTHROPIC_API_KEY || "";
}

export function mediaVisionEnabled(): boolean {
  return (envFlag(process.env.ENABLE_MEDIA_VISION) || envFlag(process.env.ENABLE_SOCIAL_MEDIA_VISION)) && Boolean(anthropicKey());
}

function visionModel(): string {
  return process.env.MEDIA_VISION_MODEL || process.env.SOCIAL_MEDIA_VISION_MODEL || process.env.THEO_REPLY_MODEL || "claude-sonnet-4-6";
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, limit: number): string {
  const text = clean(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3).trim()}...`;
}

function providerMetadata(item: OmnichannelMedia): Record<string, unknown> {
  return item.providerMetadata && typeof item.providerMetadata === "object" && !Array.isArray(item.providerMetadata)
    ? item.providerMetadata
    : {};
}

function existingMediaContext(item: OmnichannelMedia): Record<string, unknown> {
  const metadata = providerMetadata(item);
  const context = metadata.mediaContext || metadata.media_context;
  return context && typeof context === "object" && !Array.isArray(context) ? context as Record<string, unknown> : {};
}

function mediaUrl(item: OmnichannelMedia): string {
  return clean(item.url);
}

function mediaLinkUrl(item: OmnichannelMedia): string {
  const metadata = providerMetadata(item);
  return clean(metadata.linkUrl || metadata.targetUrl || item.url);
}

function isSharedSocialUrl(url: string): boolean {
  return /(?:instagram\.com|facebook\.com|fb\.watch|threads\.net|tiktok\.com|youtube\.com|youtu\.be)\//i.test(url);
}

function mediaLabel(item: OmnichannelMedia): string {
  const metadata = providerMetadata(item);
  return clean(item.filename || metadata.title || metadata.label || metadata.attachment_type);
}

function mimeFromContentType(value: string): string {
  const mime = value.split(";")[0]?.trim().toLowerCase() || "";
  return mime || "image/jpeg";
}

function inferMediaType(item: OmnichannelMedia): string {
  if (item.type && item.type !== "unknown") return item.type;
  const source = `${item.contentType || ""} ${item.filename || ""} ${item.url || ""}`.toLowerCase();
  if (source.includes("image") || /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(source)) return "image";
  if (source.includes("video") || /\.(?:mp4|mov|webm)(?:$|[?#])/i.test(source)) return "video";
  if (source.includes("audio") || /\.(?:aac|caf|m4a|mp3|mpeg|ogg|opus|wav)(?:$|[?#])/i.test(source)) return "audio";
  return "attachment";
}

function heuristicMediaContext(item: OmnichannelMedia): MediaContext {
  const linkUrl = mediaLinkUrl(item);
  const label = mediaLabel(item);
  const transcript = truncate(clean(item.transcript), 900);
  const type = inferMediaType(item);
  if (transcript) {
    return {
      mediaType: type,
      summary: `${type === "video" ? "Video/audio" : "Voice note"} says: ${transcript}`,
      confidence: 0.88,
      needsHuman: false,
      model: "heuristic_transcript",
    };
  }
  if (linkUrl && isSharedSocialUrl(linkUrl)) {
    return {
      mediaType: type === "attachment" ? "shared_social_content" : type,
      summary: `${label || "Lead shared social content"}: ${linkUrl}. Treat it as context for the current real estate conversation; if content is inaccessible, ask one short clarifying question instead of ignoring it.`,
      confidence: 0.62,
      needsHuman: false,
      model: "heuristic_social_link",
    };
  }
  if (type === "image") {
    return {
      mediaType: "image",
      summary: `${label || "Lead sent an image"}. Use it as visual context; if listing, document, screenshot, or room details are unclear, ask one concise clarifying question.`,
      confidence: 0.58,
      needsHuman: false,
      model: "heuristic_image",
    };
  }
  if (type === "video") {
    return {
      mediaType: "video",
      summary: `${label || "Lead sent a video"}. Use transcript if available; otherwise acknowledge the video and ask what they want checked from it.`,
      confidence: 0.52,
      needsHuman: false,
      model: "heuristic_video",
    };
  }
  return {
    mediaType: type,
    summary: `${label || "Lead sent an attachment"}. Use it as conversation context and ask a short follow-up if the attachment cannot be inspected.`,
    confidence: 0.5,
    needsHuman: false,
    model: "heuristic_attachment",
  };
}

async function imageBytesForVision(item: OmnichannelMedia): Promise<{ buffer: Buffer; contentType: string } | null> {
  const metadata = providerMetadata(item);
  const inlineBase64 = clean(metadata.visionBytesBase64 || metadata.vision_bytes_base64);
  const inlineType = mimeFromContentType(clean(metadata.visionContentType || metadata.vision_content_type || item.contentType));
  if (inlineBase64) {
    const buffer = Buffer.from(inlineBase64, "base64");
    return buffer.length ? { buffer, contentType: inlineType } : null;
  }
  if (!item.url) return null;
  const response = await fetch(item.url, { signal: timeoutSignal(6000) });
  if (!response.ok) return null;
  const contentType = mimeFromContentType(response.headers.get("content-type") || item.contentType || "");
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length ? { buffer, contentType } : null;
}

async function anthropicVisionContext(item: OmnichannelMedia): Promise<MediaContext | null> {
  if (!mediaVisionEnabled() || inferMediaType(item) !== "image") return null;
  try {
    const image = await imageBytesForVision(item);
    if (!image || !image.contentType.startsWith("image/") || image.buffer.byteLength > MAX_VISION_BYTES) return null;
    const prompt = "Summarize this real estate lead image for an omnichannel agent. Return compact JSON only with keys summary, extractedText, needsHuman, confidence. Focus on listing photos, rooms/features, screenshots, addresses, prices, appointment intent, lead preferences, and visible text. Do not infer protected-class traits.";
    const vision = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicKey(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: visionModel(),
        max_tokens: 260,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.contentType,
                  data: image.buffer.toString("base64"),
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
      signal: timeoutSignal(10_000),
    });
    if (!vision.ok) return null;
    const payload = await vision.json() as AnthropicVisionResponse;
    const text = clean(payload.content?.find((block) => block.type === "text")?.text || "");
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const summary = truncate(clean(parsed.summary), 700);
    if (!summary) return null;
    return {
      mediaType: "image",
      summary,
      extractedText: truncate(clean(parsed.extractedText || parsed.extracted_text), 700) || undefined,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.78)),
      needsHuman: parsed.needsHuman === true || parsed.needs_human === true,
      model: visionModel(),
    };
  } catch {
    return null;
  }
}

function publicProviderMetadata(item: OmnichannelMedia): Record<string, unknown> {
  const metadata = { ...providerMetadata(item) };
  delete metadata.visionBytesBase64;
  delete metadata.vision_bytes_base64;
  delete metadata.visionContentType;
  delete metadata.vision_content_type;
  return metadata;
}

export async function understandMediaItem(item: OmnichannelMedia): Promise<OmnichannelMedia> {
  if (existingMediaContext(item).summary) return { ...item, providerMetadata: publicProviderMetadata(item) };
  const heuristic = heuristicMediaContext(item);
  const vision = await anthropicVisionContext(item);
  const context = vision || heuristic;
  return {
    ...item,
    providerMetadata: {
      ...publicProviderMetadata(item),
      mediaContext: context,
    },
  };
}

export async function understandMediaItems(media: OmnichannelMedia[] = []): Promise<OmnichannelMedia[]> {
  const next: OmnichannelMedia[] = [];
  for (const item of media) {
    next.push(await understandMediaItem(item));
  }
  return next;
}
