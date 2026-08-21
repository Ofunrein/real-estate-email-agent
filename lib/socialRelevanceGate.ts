import type { OmnichannelMedia } from "@/lib/omnichannelEvents";

// Fail-closed relevance gate for Instagram/Messenger DMs.
//
// The agent engages on exactly three surfaces:
//   1. direct_text   - the lead typed a message, and it reads as a real estate inquiry
//   2. direct_media  - the lead sent their own photo/video/voice note into the DM
//   3. shared_post   - a reshared post/reel/story, ONLY when concrete property details
//                      are present in the caption/message or in cheap media evidence
//
// Everything else abstains. Low confidence is never a reason to reply: an abstain
// records the inbound message and stops. That is the whole point of "fail closed".

export type SocialSurface =
  | "direct_text"
  | "direct_media"
  | "shared_post"
  | "story_mention"
  | "reaction_or_sticker"
  | "empty";

export type SocialGateDecision = {
  engage: boolean;
  surface: SocialSurface;
  /** Machine-readable outcome, stored on the conversation event. */
  intent: string;
  reason: string;
  needsHuman: boolean;
  /** Concrete property details that justified engaging. */
  propertyDetails: string[];
  /** Where those details came from: "text", "caption", "media_evidence". */
  evidence: string[];
  injectionSuspected: boolean;
};

export type SocialGateInput = {
  messageText: string;
  media?: OmnichannelMedia[];
  /** Set when an upstream flow (ad DM, comment-to-DM, agent handoff) already vouched for intent. */
  routeReason?: string;
  /** Listing address supplied by the upstream flow, treated as a concrete detail. */
  listingAddress?: string;
};

const LISTING_HOST_RE = /(?:zillow|redfin|realtor|trulia|homes|har|compass|mlslistings|onehome)\.com\/|\bmls\s*#?\s*\d{4,}/i;
const STREET_ADDRESS_RE =
  /\b\d{2,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,6}\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|cir|circle|blvd|boulevard|way|pkwy|parkway|pl|place|path|trl|trail|ter|terrace|hwy|highway)\b/i;
const PRICE_RE = /\$\s?\d[\d,.]*(?:\s?[kKmM])?|\b\d{3,4}\s?k\b|\b\d{3},\d{3}\b/;
const BEDS_RE = /\b(?:[1-9]|one|two|three|four|five|six)\s*(?:bd|br|bed|beds|bedroom|bedrooms)\b/i;
const BATHS_RE = /\b\d(?:\.\d)?\s*(?:ba|bath|baths|bathroom|bathrooms)\b/i;
const SQFT_RE = /\b\d{3,5}\s*(?:sq\.?\s?ft|sqft|square feet)\b/i;
const ZIP_RE = /\b7\d{4}\b/;
const UNIT_RE = /\b(?:unit|apt|apartment|suite|#)\s?[a-z]?\d{1,5}[a-z]?\b/i;

// Real estate intent for a typed message. Deliberately narrower than a keyword soup:
// "home" alone is a meme word, "3 bed in 78704" is an inquiry.
const REAL_ESTATE_INQUIRY_RE =
  /\b(?:availab(?:le|ility)|for sale|for rent|listing|listings|showing|tour|walkthrough|open house|schedule|book|price|pricing|asking|rent|rental|lease|move.?in|mortgage|pre.?approv\w*|budget|square feet|sqft|bed|beds|bedroom|bath|baths|house|home|homes|condo|townhome|apartment|property|properties|realtor|real estate|buy|buying|sell|selling|valuation|appraisal|worth|comps?|neighborhood|inventory|mls|hoa|closing|escrow|down payment)\b/i;

const PERSONAL_OR_MEME_RE =
  /\b(?:happy birthday|congrats|congratulations|coffee|lunch|party|hang out|lol+|lmao|haha+|meme|funny|nice pic|love this|fire|goat|bro|dude|wyd|how are you|what'?s up|whats up|gm|good morning|good night)\b/i;

const INJECTION_RE =
  /\b(?:ignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules?)|disregard (?:your|all|the) (?:instructions?|rules?|prompt)|system prompt|you are now|new instructions?|act as|pretend (?:to be|you are)|reveal (?:your|the) (?:prompt|instructions?|system)|print your (?:prompt|instructions?)|developer mode|jailbreak|api[_ -]?key|access token|forget (?:your|all) (?:rules?|instructions?)|override (?:your|the) (?:safety|rules?|guardrails?))\b/i;

const HANDOFF_RE =
  /\b(?:contract|offer terms|inspection|legal|attorney|lawsuit|commission|representation|loan officer|credit score|apr|interest rate|section 8|voucher|safe neighborhood|crime rate|school rating|scam|fraud|lawyer)\b/i;

const SHARE_ATTACHMENT_RE = /share|ig_reel|reel|story|template|fallback|link/i;
const STORY_MENTION_RE = /story_mention|story_reply/i;
const SHARED_HOST_RE = /(?:instagram\.com|facebook\.com|fb\.watch|threads\.net|tiktok\.com|youtube\.com|youtu\.be)\//i;

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function metadata(item: OmnichannelMedia): Record<string, unknown> {
  return item.providerMetadata && typeof item.providerMetadata === "object" && !Array.isArray(item.providerMetadata)
    ? item.providerMetadata
    : {};
}

function mediaContext(item: OmnichannelMedia): Record<string, unknown> {
  const context = metadata(item).mediaContext || metadata(item).media_context;
  return context && typeof context === "object" && !Array.isArray(context) ? context as Record<string, unknown> : {};
}

/** True when the media item is a reshare of somebody else's post rather than the lead's own upload. */
export function isSharedPostMedia(item: OmnichannelMedia): boolean {
  const meta = metadata(item);
  const attachmentType = clean(meta.attachment_type || meta.attachmentType);
  if (STORY_MENTION_RE.test(attachmentType)) return true;
  if (SHARE_ATTACHMENT_RE.test(attachmentType)) return true;
  const linkUrl = clean(meta.linkUrl || meta.targetUrl || meta.permalink);
  if (linkUrl && SHARED_HOST_RE.test(linkUrl)) return true;
  return SHARED_HOST_RE.test(clean(item.url)) && Boolean(clean(meta.thumbnailUrl));
}

export function classifySocialSurface(input: SocialGateInput): SocialSurface {
  const media = (input.media || []).filter(Boolean);
  const text = clean(input.messageText).replace(/^\[(?:image|video|audio|attachment|file)\]$/i, "");
  if (media.length) {
    const storyMention = media.some((item) => STORY_MENTION_RE.test(clean(metadata(item).attachment_type)));
    if (storyMention) return "story_mention";
    if (media.some(isSharedPostMedia)) return "shared_post";
    const sticker = media.every((item) => /sticker|reaction/i.test(clean(metadata(item).attachment_type)));
    if (sticker) return "reaction_or_sticker";
    return "direct_media";
  }
  if (text) return "direct_text";
  return "empty";
}

/**
 * Concrete property details, not vibes. A shared post needs at least one of these
 * before the agent is allowed to answer it.
 */
export function extractPropertyDetails(text: string): string[] {
  const value = clean(text);
  if (!value) return [];
  const found: string[] = [];
  const address = value.match(STREET_ADDRESS_RE);
  if (address) found.push(`address:${address[0]}`);
  const price = value.match(PRICE_RE);
  if (price) found.push(`price:${price[0].trim()}`);
  const beds = value.match(BEDS_RE);
  if (beds) found.push(`beds:${beds[0].trim()}`);
  const baths = value.match(BATHS_RE);
  if (baths) found.push(`baths:${baths[0].trim()}`);
  const sqft = value.match(SQFT_RE);
  if (sqft) found.push(`sqft:${sqft[0].trim()}`);
  const zip = value.match(ZIP_RE);
  if (zip) found.push(`zip:${zip[0]}`);
  const unit = value.match(UNIT_RE);
  if (unit) found.push(`unit:${unit[0].trim()}`);
  const listing = value.match(LISTING_HOST_RE);
  if (listing) found.push(`listing_url:${listing[0]}`);
  return found;
}

/**
 * Concrete enough to answer. A street address or a listing URL is unambiguous on its own.
 * Softer signals (a price, a bedroom count, a zip) only count in combination, so
 * "this meme cost me $5" never reads as a listing.
 */
export function hasConcretePropertyDetails(details: string[]): boolean {
  if (details.some((detail) => detail.startsWith("address:") || detail.startsWith("listing_url:"))) return true;
  return new Set(details.map((detail) => detail.split(":")[0])).size >= 2;
}

/**
 * Text the agent is allowed to treat as media evidence. Only cheap, already-computed
 * artifacts: a thumbnail/first-frame vision summary, extracted on-image text, or a
 * transcript. Never a full-resolution download and never the raw media URL.
 *
 * Heuristic placeholder summaries ("Lead shared social content: <url>") are excluded on
 * purpose. They describe the envelope, not the content, so letting them count as
 * evidence would turn every reshare into a reply.
 */
export function mediaEvidenceText(media: OmnichannelMedia[] = []): string {
  return media
    .map((item) => {
      const context = mediaContext(item);
      const model = clean(context.model);
      const inspected = !model.startsWith("heuristic_") || model === "heuristic_transcript";
      return [
        inspected ? clean(context.summary) : "",
        inspected ? clean(context.extractedText || context.extracted_text) : "",
        clean(item.transcript),
      ].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

/** True when a media item exposes no cheap evidence path at all (no thumbnail, no context, no transcript). */
export function isMediaInspectable(item: OmnichannelMedia): boolean {
  const meta = metadata(item);
  if (clean(meta.thumbnailUrl || meta.thumbnail_url)) return true;
  if (mediaEvidenceText([item])) return true;
  return item.type === "image" && Boolean(clean(item.url)) && !isSharedPostMedia(item);
}

function abstain(
  surface: SocialSurface,
  intent: string,
  reason: string,
  extra: Partial<SocialGateDecision> = {},
): SocialGateDecision {
  return {
    engage: false,
    surface,
    intent,
    reason,
    needsHuman: false,
    propertyDetails: [],
    evidence: [],
    injectionSuspected: false,
    ...extra,
  };
}

export function evaluateSocialRelevance(input: SocialGateInput): SocialGateDecision {
  const media = (input.media || []).filter(Boolean);
  const surface = classifySocialSurface(input);
  const rawText = clean(input.messageText);
  // Placeholder text the webhook substitutes for attachment-only DMs carries no meaning.
  const text = rawText.replace(/\[(?:image|video|audio|attachment|file)\]/gi, "").trim();
  const evidence = mediaEvidenceText(media);
  const injectionSuspected = INJECTION_RE.test(rawText) || INJECTION_RE.test(evidence);
  const routeReason = clean(input.routeReason);
  const listingAddress = clean(input.listingAddress);

  if (injectionSuspected) {
    return abstain(surface, "prompt_injection_suspected", "Prompt-injection style content, not answered", {
      needsHuman: true,
      injectionSuspected: true,
    });
  }

  if (surface === "empty") {
    return abstain(surface, "empty_message", "No text and no media to act on");
  }
  if (surface === "reaction_or_sticker") {
    return abstain(surface, "reaction_or_sticker", "Reaction or sticker, nothing to answer");
  }

  const textDetails = extractPropertyDetails(text);
  const evidenceDetails = extractPropertyDetails(evidence);
  const addressDetails = listingAddress ? extractPropertyDetails(listingAddress) : [];
  const needsHuman = HANDOFF_RE.test(text);

  if (surface === "direct_text") {
    if (!REAL_ESTATE_INQUIRY_RE.test(text) && !routeReason && !listingAddress) {
      return abstain(surface, "not_real_estate", "Direct text has no real estate inquiry signal");
    }
    if (PERSONAL_OR_MEME_RE.test(text) && !textDetails.length && !routeReason) {
      return abstain(surface, "personal_social", "Direct text reads as personal or meme chatter");
    }
    return {
      engage: true,
      surface,
      intent: needsHuman ? "human_required" : routeReason || "real_estate_inquiry",
      reason: "",
      needsHuman,
      propertyDetails: [...textDetails, ...addressDetails],
      evidence: ["text"],
      injectionSuspected: false,
    };
  }

  if (surface === "direct_media") {
    // The lead uploaded this into our DM on purpose. Engaging is correct even when the
    // file cannot be inspected: the safe reply is one clarifying question.
    const inspectable = media.some(isMediaInspectable);
    return {
      engage: true,
      surface,
      intent: needsHuman ? "human_required" : "lead_sent_media",
      reason: inspectable ? "" : "Lead media could not be inspected, ask one clarifying question",
      needsHuman,
      propertyDetails: [...textDetails, ...evidenceDetails, ...addressDetails],
      evidence: [
        ...(textDetails.length ? ["text"] : []),
        ...(evidenceDetails.length ? ["media_evidence"] : []),
      ],
      injectionSuspected: false,
    };
  }

  // shared_post and story_mention: the strict path. A reshare is only answerable when
  // concrete property details exist in the caption, the upstream listing address, or cheap
  // media evidence. Concrete details are themselves the topicality proof, so there is no
  // separate keyword gate to argue with.
  if (!media.some(isMediaInspectable) && !textDetails.length && !listingAddress) {
    return abstain(surface, "media_not_inspectable", "Shared post is not inspectable and the caption has no property details");
  }
  const captionDetails = [...textDetails, ...addressDetails];
  const allDetails = [...captionDetails, ...evidenceDetails];
  if (!hasConcretePropertyDetails(allDetails)) {
    return abstain(
      surface,
      surface === "story_mention" ? "story_mention" : "shared_post_no_property_details",
      surface === "story_mention"
        ? "Story mention without concrete property details"
        : "Shared post has no concrete property details in the caption or in media evidence",
    );
  }
  return {
    engage: true,
    surface,
    intent: needsHuman ? "human_required" : routeReason || "shared_property_post",
    reason: "",
    needsHuman,
    propertyDetails: allDetails,
    evidence: [
      ...(captionDetails.length ? ["caption"] : []),
      ...(evidenceDetails.length ? ["media_evidence"] : []),
    ],
    injectionSuspected: false,
  };
}
