import { createHash } from "node:crypto";

type VoiceNoteResult = {
  url: string;
  filename: string;
  contentType: string;
  storage: string;
  model?: string;
};

const TTL_MS = Number(process.env.IRIS_VOICE_NOTE_CACHE_MS || 60 * 60 * 1000);
const MAX_PER_MINUTE = Number(process.env.IRIS_VOICE_NOTE_MAX_PER_MINUTE || 20);
const cache = new Map<string, { value: VoiceNoteResult; expiresAt: number }>();
const recent = new Map<string, number[]>();

export function voiceNoteCacheKey(input: {
  provider: string;
  text: string;
  voiceId?: string;
  model?: string;
  smsCompatible?: boolean;
}) {
  const hash = createHash("sha256")
    .update(JSON.stringify({
      provider: input.provider,
      text: input.text.trim(),
      voiceId: input.voiceId || "",
      model: input.model || "",
      smsCompatible: Boolean(input.smsCompatible),
    }))
    .digest("hex");
  return `voice-note:${hash}`;
}

export function getCachedVoiceNote(key: string): VoiceNoteResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function setCachedVoiceNote(key: string, value: VoiceNoteResult) {
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

export function checkVoiceNoteRateLimit(scope: string) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (recent.get(scope) || []).filter((time) => time >= windowStart);
  if (hits.length >= MAX_PER_MINUTE) {
    recent.set(scope, hits);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + 60_000 - now) / 1000)) };
  }
  hits.push(now);
  recent.set(scope, hits);
  return { ok: true, retryAfterSeconds: 0 };
}
