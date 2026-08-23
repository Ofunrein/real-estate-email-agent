// Apple Messages reply formatting: normalization + deterministic checks.
//
// Why this module exists: text-channel replies are read in Apple Messages, not in a
// Markdown renderer. Messages has no bold, no headings, no link syntax, and it makes a
// long single line look like a wall. It DOES render newlines and blank lines faithfully,
// so blank lines are the only structural tool available - which means they have to be
// spent deliberately, and the shape has to change with the kind of answer being given.
//
// Everything here is pure and synchronous so `tests/ts/smsFormatting.test.ts` can assert
// on it directly, and so `scripts/imessage-reply-evals.mjs` can gate generated replies
// before they ever reach a judge or a phone.

import { containsEmDash, removeEmDashes } from "@/lib/noEmDash";

// One family per shape of answer. The point of the split is that a short acknowledgement
// and a three-listing roundup should NOT come out of the same template.
export type MessagesReplyFamily =
  | "short_ack"
  | "single_property"
  | "multi_listing"
  | "missing_details"
  | "followup_question"
  | "sensitive_handoff"
  | "scheduling"
  | "shared_property_context"
  | "general";

export const MESSAGES_REPLY_FAMILIES: readonly MessagesReplyFamily[] = [
  "short_ack",
  "single_property",
  "multi_listing",
  "missing_details",
  "followup_question",
  "sensitive_handoff",
  "scheduling",
  "shared_property_context",
  "general",
];

export type MessagesBudget = {
  /** Hard upper bound on rendered characters. */
  maxChars: number;
  /** Blank-line-separated blocks allowed. A one-line ack gets exactly one. */
  maxBlocks: number;
  /** Total non-empty lines allowed. */
  maxLines: number;
  /** How many questions the reply may ask. Never more than one for text channels. */
  maxQuestions: number;
};

// Budgets count an isolated URL paragraph as its own block, because that is what it renders as.
const BUDGETS: Record<MessagesReplyFamily, MessagesBudget> = {
  short_ack: { maxChars: 160, maxBlocks: 1, maxLines: 2, maxQuestions: 1 },
  followup_question: { maxChars: 260, maxBlocks: 3, maxLines: 5, maxQuestions: 1 },
  missing_details: { maxChars: 280, maxBlocks: 2, maxLines: 4, maxQuestions: 1 },
  scheduling: { maxChars: 320, maxBlocks: 3, maxLines: 6, maxQuestions: 1 },
  sensitive_handoff: { maxChars: 340, maxBlocks: 3, maxLines: 6, maxQuestions: 1 },
  general: { maxChars: 400, maxBlocks: 4, maxLines: 7, maxQuestions: 1 },
  single_property: { maxChars: 620, maxBlocks: 5, maxLines: 10, maxQuestions: 1 },
  shared_property_context: { maxChars: 620, maxBlocks: 5, maxLines: 10, maxQuestions: 1 },
  multi_listing: { maxChars: 1200, maxBlocks: 12, maxLines: 24, maxQuestions: 1 },
};

/** A line longer than this reads as a wall on an iPhone regardless of total length. */
export const MESSAGES_MAX_LINE_CHARS = 180;

export function messagesBudget(family: MessagesReplyFamily = "general"): MessagesBudget {
  return BUDGETS[family] || BUDGETS.general;
}

// Robotic openers and label-colon dumps. These are what make a reply read like a form
// print-out instead of a person typing. Matched at line start so a real street name that
// happens to contain one of these words is not flagged.
const ROBOTIC_LABEL_PATTERNS: ReadonlyArray<{ code: string; re: RegExp; label: string }> = [
  {
    code: "robotic_label",
    label: "label-colon prefix",
    re: /^(?:property details|listing details|details|next steps?|summary|overview|key facts|highlights|action items?|notes?|options|information|address|price|beds|baths|sqft|square feet|year built|status|listing|link|links|photos?|features|amenities)\s*:/im,
  },
  { code: "robotic_label", label: "\"Sending the property photo(s) for:\"", re: /^sending the (?:property )?photos?\b/im },
  { code: "robotic_label", label: "\"Here are the listing links:\"", re: /^here (?:are|is) the (?:listing )?links\s*:/im },
  { code: "robotic_label", label: "\"Here is the cleanest comparison\"", re: /^here is the cleanest comparison\b/im },
  { code: "robotic_label", label: "\"Status for <address>:\"", re: /^status for\b/im },
  { code: "robotic_label", label: "\"Lowest/Highest listed price\"", re: /^(?:lowest|highest) listed price\b/im },
  { code: "robotic_label", label: "\"Largest/Smallest saved listing\"", re: /^(?:largest|smallest) saved listing\b/im },
  { code: "robotic_label", label: "\"the saved listing notes mention\"", re: /\bthe saved listing (?:notes mention|text mentions)\b/i },
  { code: "robotic_label", label: "\"I have <x> in the saved listing inventory\"", re: /\bsaved listing inventory\b/i },
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
// U+FFFC OBJECT REPLACEMENT / U+FFFD REPLACEMENT. These leak in from attachment
// placeholders and other transcoding, and render as a stray glyph in Messages.
const PLACEHOLDER_CHAR_RE = /[￼�]/g;

export type FormattingViolation = { code: string; detail: string };

function isUrlLine(line: string): boolean {
  if (!/https?:\/\//i.test(line)) return false;
  return line.replace(/https?:\/\/\S+/gi, "").trim().length <= 40;
}

/**
 * Make a candidate reply render correctly in Apple Messages without changing its meaning.
 *
 * Deliberately NOT `text.replace(/\s+/g, " ")`. That is the bug this module was written
 * against: collapsing all whitespace destroyed every intentional blank line and turned
 * every reply into one unreadable line.
 */
/**
 * Break one over-long line into blank-line-separated blocks at sentence boundaries.
 *
 * The live SMS suite caught this: the model path answers a compliance question in a single
 * 286-character paragraph, which lands in Messages as an unbroken grey wall. Normalizing
 * punctuation and Markdown was never enough on its own - nothing was inserting the breaks.
 *
 * Splits only between sentences. A single sentence longer than the limit is left alone rather
 * than chopped mid-clause, because a break in the wrong place reads worse than a long line.
 */
// Sentinel-delimited placeholders, written as escapes so no raw control byte lands in source.
// A bare numeric placeholder would be indistinguishable from a list ordinal ("1.") and the two
// passes below would corrupt each other.
const MASK_OPEN = "";
const MASK_CLOSE = "";

function maskUrls(text: string): { masked: string; restore: (value: string) => string } {
  const urls: string[] = [];
  const masked = text.replace(/https?:\/\/\S+/gi, (url) => {
    urls.push(url);
    return `${MASK_OPEN}${urls.length - 1}${MASK_CLOSE}`;
  });
  const restore = (value: string) =>
    value.replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, "g"), (_m, index) => urls[Number(index)] ?? "");
  return { masked, restore };
}

/**
 * "I found 3 matches: 1. 6828 Walkup Ln ... 2. 6814 Old Quarry Ln ..." arrives as ONE line. Each
 * numbered item has to start its own line before anything else can lay it out. The screenshots of
 * the live thread showed a whole three-listing roundup as a single run-on paragraph.
 */
function splitInlineListItems(line: string): string {
  if (!/\d{1,2}\.\s/.test(line)) return line;
  const { masked, restore } = maskUrls(line);
  return restore(masked.replace(/(\S)\s+(?=\d{1,2}\.\s)/g, "$1\n"));
}

function breakLongLine(line: string): string[] {
  if (line.length <= MESSAGES_MAX_LINE_CHARS || isUrlLine(line)) return [line];
  // Mask URLs first. "zillow.com/..." is full of periods, and splitting on them tore a link in
  // half mid-token, which then defeated URL-aware handling everywhere downstream.
  const { masked, restore } = maskUrls(line);
  // A list ordinal is not a sentence end. Without this, "1. 6828 Walkup Ln" split into one
  // paragraph holding just "1." and another holding the address.
  const ordinal = masked.match(/^\d{1,2}\.\s+/)?.[0] || "";
  const body = masked.slice(ordinal.length);

  const sentences = body.match(/[^.!?]+(?:[.!?]+|$)/g);
  if (!sentences || sentences.length < 2) return [restore(masked)];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    const candidate = current ? `${current} ${piece}` : piece;
    if (current && restore(candidate).length > MESSAGES_MAX_LINE_CHARS) {
      chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  if (!chunks.length) return [restore(masked)];
  if (ordinal) chunks[0] = `${ordinal}${chunks[0]}`;
  return chunks.map(restore);
}

/** A label that only exists to introduce the link. Once the URL is its own paragraph it is noise. */
const TRAILING_URL_LABEL_RE = /[\s,;:-]*\b(?:listing|listing link|link|links|url|photos?|view|see it|more info|details)\s*:?\s*$/i;

/**
 * Messaging invariant: a URL is its own paragraph.
 *
 * Every URL starts and ends its own line, with a blank line before and after, and nothing
 * else on that line. Text that followed the URL becomes a new paragraph. Leading and trailing
 * blank lines are never introduced at the message boundaries.
 *
 * This exists because the live channel shipped "…, Downtown Austin Listing: https://… Want me
 * to send photos?" as one run-on line, where the link is unreadable and barely tappable.
 * Enforced here, in the shared finalization path, so SMS, iMessage, WhatsApp, website chat and
 * social DMs all inherit it rather than relying on prompt instructions.
 */
function isolateUrls(text: string): string {
  const out: string[] = [];
  const pushBlank = () => {
    if (out.length && out[out.length - 1] !== "") out.push("");
  };

  for (const line of text.split("\n")) {
    if (!/https?:\/\//i.test(line)) {
      out.push(line);
      continue;
    }
    let cursor = 0;
    for (const match of line.matchAll(/https?:\/\/\S+/gi)) {
      const index = match.index ?? 0;
      let url = match[0];
      // Sentence punctuation that trailed the link is not part of it. A trailing "/" is.
      const trailing = url.match(/[).,;:!?]+$/)?.[0] || "";
      if (trailing) url = url.slice(0, url.length - trailing.length);

      const before = line
        .slice(cursor, index)
        .replace(TRAILING_URL_LABEL_RE, "")
        // A bracket that was opened only to wrap the link has nothing left to wrap.
        .replace(/[([{"'\s]+$/, "")
        .trim();
      if (before && /[a-z0-9]/i.test(before)) out.push(before);
      pushBlank();
      out.push(url);
      out.push("");
      cursor = index + match[0].length;
    }
    const after = line.slice(cursor).replace(/^[\s).,;:!?-]+/, "").trim();
    if (after) out.push(after);
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeMessagesReply(value: string): string {
  let text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(PLACEHOLDER_CHAR_RE, "");

  text = removeEmDashes(text);

  // Models emit typographic punctuation. Straighten it so the text renders consistently
  // and so downstream assertions on generated copy do not chase phantom mismatches
  // (/can'?t/ never matches "can’t").
  text = text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/–/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");

  // Strip Markdown that Messages cannot render, keeping the words.
  text = text
    .replace(/```+/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // [label](https://x) -> "label https://x", or just the URL when the label adds nothing.
    .replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi, (_m, label: string, url: string) => {
      const clean = String(label).trim();
      if (!clean || /^(?:link|listing|here|view|see|click)$/i.test(clean)) return url;
      return `${clean} ${url}`;
    })
    // Markdown bullets become plain lines. Messages already separates lines visually.
    .replace(/^\s*[-*•]\s+/gm, "");

  const lines = text
    .split("\n")
    // A run-on "1. … 2. … 3. …" becomes one line per item before anything else lays it out.
    .flatMap((line) => splitInlineListItems(line).split("\n"))
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  // Separate a numbered list from whatever introduced it, but keep consecutive one-line
  // items tight. A blank line between every "1." / "2." only helps when each item is
  // itself multi-line, and multi-line items already arrive block-separated.
  const spaced: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isItem = /^\d+\.\s/.test(line);
    const previous = spaced[spaced.length - 1];
    if (isItem && previous !== undefined && previous !== "" && !/^\d+\.\s/.test(previous)) {
      spaced.push("");
    }
    // A wall becomes blocks, not one long line. A numbered item can be a wall too: the live
    // roundup put a whole listing plus its link on one "1. …" line.
    if (line.length > MESSAGES_MAX_LINE_CHARS) {
      const chunks = breakLongLine(line);
      chunks.forEach((chunk, chunkIndex) => {
        if (chunkIndex > 0) spaced.push("");
        spaced.push(chunk);
      });
      continue;
    }
    spaced.push(line);
  }

  return isolateUrls(
    spaced
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

/** Blank-line-separated blocks, empties dropped. The only structural join we use. */
export function messagesBlocks(...parts: Array<string | false | null | undefined>): string {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The last thing that touches ANY outbound text-channel body before it is serialized for a
 * provider. SMS, RCS, iMessage, WhatsApp, website chat and social DMs all share one contract, so
 * they share one finalizer - a per-transport copy is how three of them drifted and shipped walls.
 *
 * Tenant-independent by construction: it reads no client id, no env, and no config. Every
 * client/tenant inherits identical spacing because there is nothing here to configure.
 */
export function finalizeOutboundTextBody(body: string): string {
  return normalizeMessagesReply(removeEmDashes(String(body || "")));
}

/**
 * Attach media URLs to a body as their own paragraphs. A label sharing the URL's line
 * ("WhatsApp image: https://…") is exactly what made links unreadable on a phone.
 */
export function finalizeOutboundTextWithMedia(body: string, mediaUrls: string[] = []): string {
  const urls = mediaUrls.map((url) => String(url || "").trim()).filter(Boolean);
  return finalizeOutboundTextBody([finalizeOutboundTextBody(body), ...urls].filter(Boolean).join("\n\n"));
}

export function messagesLines(text: string): string[] {
  return normalizeMessagesReply(text).split("\n").filter((line) => line.trim().length > 0);
}

export function messagesBlockCount(text: string): number {
  const normalized = normalizeMessagesReply(text);
  if (!normalized) return 0;
  return normalized.split("\n\n").filter((block) => block.trim().length > 0).length;
}

/**
 * Deterministic variant choice. Gives replies real shape variety without randomness, so
 * tests and evals stay reproducible while the lead does not see the same canned tail
 * on every message.
 */
export function pickVariant<T>(variants: readonly T[], seed: string): T {
  if (!variants.length) throw new Error("pickVariant requires at least one variant");
  let hash = 2166136261;
  const text = String(seed || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return variants[Math.abs(hash) % variants.length] as T;
}

/** Comparable core of a reply: used to catch "we just sent this exact block" repeats. */
export function replyFingerprint(value: string): string {
  return normalizeMessagesReply(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function repeatsRecentReply(candidate: string, priorOutbound: string): boolean {
  const next = replyFingerprint(candidate);
  const prior = replyFingerprint(priorOutbound);
  if (!next || !prior) return false;
  if (next === prior) return true;
  // A near-repeat is still a repeat to the person reading it.
  const shorter = next.length <= prior.length ? next : prior;
  const longer = next.length <= prior.length ? prior : next;
  return shorter.length >= 60 && longer.includes(shorter);
}

/**
 * Trim to budget by dropping whole trailing blocks before ever cutting mid-sentence.
 * Losing the closing question is better than shipping a severed clause with an ellipsis.
 */
export function fitMessagesReply(value: string, limit: number): string {
  const normalized = normalizeMessagesReply(value);
  if (normalized.length <= limit) return normalized;

  const blocks = normalized.split("\n\n").filter((block) => block.trim().length > 0);
  while (blocks.length > 1) {
    blocks.pop();
    const candidate = blocks.join("\n\n");
    if (candidate.length <= limit) return candidate;
  }

  const slice = normalized.slice(0, Math.max(0, limit - 1)).trimEnd();
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("\n"),
  );
  if (sentenceEnd > Math.floor(limit * 0.5)) {
    const end = sentenceEnd + (slice[sentenceEnd] === "\n" ? 0 : 1);
    return slice.slice(0, end).trimEnd();
  }
  return `${slice}...`;
}

export type FormattingCheckOptions = {
  family?: MessagesReplyFamily;
  /** Skip the budget checks when the caller only wants artifact checks. */
  skipBudget?: boolean;
};

/**
 * Every deterministic thing that can be wrong with how a reply reads in Messages.
 * Returns [] for a clean reply so it composes as a gate.
 */
export function checkMessagesFormatting(value: string, options: FormattingCheckOptions = {}): FormattingViolation[] {
  const raw = String(value || "");
  const violations: FormattingViolation[] = [];
  const family = options.family || "general";
  const budget = messagesBudget(family);

  if (!raw.trim()) {
    return [{ code: "empty", detail: "reply is empty" }];
  }

  // --- artifacts that must never survive to a phone ------------------------
  if (/\*\*/.test(raw)) violations.push({ code: "markdown_bold", detail: "contains ** bold markers" });
  if (/__/.test(raw)) violations.push({ code: "markdown_underscore", detail: "contains __ emphasis markers" });
  if (/^\s{0,3}#{1,6}\s+/m.test(raw)) violations.push({ code: "markdown_heading", detail: "contains a # heading" });
  if (/\[[^\]]*\]\([^)\s]+\)/.test(raw)) violations.push({ code: "markdown_link", detail: "contains a [](…) Markdown link" });
  if (/`/.test(raw)) violations.push({ code: "markdown_code", detail: "contains a backtick" });
  if (/^\s*[-*•]\s+/m.test(raw)) violations.push({ code: "markdown_bullet", detail: "uses Markdown/bullet list markers instead of Messages lines" });
  if (containsEmDash(raw)) violations.push({ code: "em_dash", detail: "contains an em dash" });
  if (PLACEHOLDER_CHAR_RE.test(raw)) violations.push({ code: "placeholder_char", detail: "contains U+FFFC/U+FFFD placeholder characters" });
  if (EMOJI_RE.test(raw)) violations.push({ code: "emoji", detail: "contains an emoji" });

  for (const { code, re, label } of ROBOTIC_LABEL_PATTERNS) {
    if (re.test(raw)) violations.push({ code, detail: `robotic label: ${label}` });
  }

  // --- spacing -------------------------------------------------------------
  if (/\n{3,}/.test(raw.replace(/\r\n?/g, "\n"))) {
    violations.push({ code: "excess_blank_lines", detail: "3 or more consecutive newlines" });
  }
  if (/^\s*\n/.test(raw)) violations.push({ code: "leading_blank", detail: "starts with a blank line" });
  if (/\n\s*$/.test(raw)) violations.push({ code: "trailing_blank", detail: "ends with a blank line or trailing newline" });
  if (/[ \t]+\n/.test(raw)) violations.push({ code: "trailing_space", detail: "line ends with trailing whitespace" });

  // The wall check reads RAW lines on purpose. normalizeMessagesReply now splits walls into
  // blocks, so checking normalized text here would make this rule permanently unreachable and
  // silently stop reporting what the generator actually produced.
  const rawLines = raw.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of rawLines) {
    if (line.length > MESSAGES_MAX_LINE_CHARS && !isUrlLine(line)) {
      violations.push({
        code: "line_wall",
        detail: `single line of ${line.length} chars with no break (max ${MESSAGES_MAX_LINE_CHARS})`,
      });
      break;
    }
  }

  // A URL sharing a line with prose is unreadable and barely tappable on a phone. Checked on
  // RAW input so it reports what the generator produced, not what normalization repaired.
  for (const line of rawLines) {
    if (!/https?:\/\//i.test(line)) continue;
    const withoutUrls = line.replace(/https?:\/\/\S+/gi, "").trim();
    if (withoutUrls) {
      violations.push({
        code: "url_not_isolated",
        detail: `URL shares a line with "${withoutUrls.slice(0, 60)}"`,
      });
      break;
    }
  }

  const lines = messagesLines(raw);

  // Same sentence twice in one message reads like a bug, because it is one.
  const seen = new Set<string>();
  for (const line of lines) {
    if (isUrlLine(line) || line.length < 25) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) {
      violations.push({ code: "repeated_line", detail: `line repeated verbatim: "${line.slice(0, 60)}"` });
      break;
    }
    seen.add(key);
  }

  // --- list discipline -----------------------------------------------------
  const numbered = lines.filter((line) => /^\d+\.\s/.test(line));
  if (numbered.length === 1) {
    violations.push({ code: "single_item_list", detail: "numbered list with only one item" });
  }

  // --- shape budget --------------------------------------------------------
  const normalized = normalizeMessagesReply(raw);
  const questions = (normalized.match(/\?/g) || []).length;
  if (questions > budget.maxQuestions) {
    violations.push({ code: "too_many_questions", detail: `${questions} questions (max ${budget.maxQuestions} for ${family})` });
  }

  if (!options.skipBudget) {
    if (normalized.length > budget.maxChars) {
      violations.push({ code: "over_budget", detail: `${normalized.length} chars (max ${budget.maxChars} for ${family})` });
    }
    const blocks = messagesBlockCount(normalized);
    if (blocks > budget.maxBlocks) {
      violations.push({ code: "too_many_blocks", detail: `${blocks} blocks (max ${budget.maxBlocks} for ${family})` });
    }
    if (lines.length > budget.maxLines) {
      violations.push({ code: "too_many_lines", detail: `${lines.length} lines (max ${budget.maxLines} for ${family})` });
    }
    if (family === "short_ack" && blocks > 1) {
      violations.push({ code: "ack_not_single_block", detail: "a short acknowledgement must be a single block" });
    }
  }

  return violations;
}

export function isMessagesFormattingClean(value: string, options: FormattingCheckOptions = {}): boolean {
  return checkMessagesFormatting(value, options).length === 0;
}
