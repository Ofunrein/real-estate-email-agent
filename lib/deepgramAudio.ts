import { normalizeGeneratedVoiceNote, normalizeMediaForTranscription } from "@/lib/audioTranscode";

import { saveMediaUpload } from "@/lib/mediaUploads";

const DEEPGRAM_DEFAULT_TTS_MODEL = "aura-asteria-en";

function deepgramTtsModel(inputModel?: string): string {
  return inputModel || process.env.DEEPGRAM_TTS_MODEL || DEEPGRAM_DEFAULT_TTS_MODEL;
}

function deepgramSpeakUrl(model?: string): string {
  const params = new URLSearchParams({ model: deepgramTtsModel(model) });
  return `https://api.deepgram.com/v1/speak?${params.toString()}`;
}

function audioFilename(prefix: string, extension = "mp3"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
}

export const DEEPGRAM_VOICE_PRESETS = [
  { id: "aura-asteria-en", label: "Asteria", provider: "deepgram", gender: "female", style: "warm" },
  { id: "aura-luna-en", label: "Luna", provider: "deepgram", gender: "female", style: "friendly" },
  { id: "aura-stella-en", label: "Stella", provider: "deepgram", gender: "female", style: "clear" },
  { id: "aura-athena-en", label: "Athena", provider: "deepgram", gender: "female", style: "professional" },
  { id: "aura-hera-en", label: "Hera", provider: "deepgram", gender: "female", style: "confident" },
  { id: "aura-orion-en", label: "Orion", provider: "deepgram", gender: "male", style: "calm" },
] as const;

export async function createDeepgramVoiceNote(input: {
  text: string;
  model?: string;
  requestUrl: string;
  threadRef?: string;
 smsCompatible?: boolean;
}): Promise<{ url: string; filename: string; contentType: string; storage: string; model: string }> {
  const apiKey = deepgramApiKey();
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is required");
  const text = input.text.trim();
  if (!text) throw new Error("Voice note text is required");
  const model = deepgramTtsModel(input.model);
  const response = await fetch(deepgramSpeakUrl(model), {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Deepgram voice note failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const filename = audioFilename("deepgram-voice-note", "mp3");
  const file = new File([bytes], filename, { type: "audio/mpeg" });
  const uploaded = await saveMediaUpload({
    file,
    threadRef: input.threadRef || "deepgram-voice-note",
    requestUrl: input.requestUrl,
  });
  return { url: uploaded.url, filename: uploaded.filename, contentType: file.type || "audio/mpeg", storage: uploaded.storage, model };
}


type DeepgramAlternative = {
  transcript?: string;
  confidence?: number;
  words?: unknown[];
  paragraphs?: unknown;
};

type DeepgramResponse = {
  metadata?: {
    duration?: number;
  };
  results?: {
    channels?: Array<{
      alternatives?: DeepgramAlternative[];
    }>;
  };
};

function deepgramApiKey(): string {
  return process.env.DEEPGRAM_API_KEY || "";
}

export function deepgramAudioEnabled(): boolean {
  return Boolean(deepgramApiKey());
}

function deepgramModel(): string {
  return process.env.DEEPGRAM_STT_MODEL || "nova-3";
}

function deepgramListenUrl(): string {
  const params = new URLSearchParams({
    model: deepgramModel(),
    language: process.env.DEEPGRAM_STT_LANGUAGE || "en",
    smart_format: "true",
    punctuate: "true",
    paragraphs: "true",
  });
  return `https://api.deepgram.com/v1/listen?${params.toString()}`;
}

export async function transcribeDeepgramAudio(file: File): Promise<{
  text: string;
  duration?: number;
  segments?: unknown;
}> {
  const apiKey = deepgramApiKey();
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is required");

  const normalized = await normalizeMediaForTranscription(file);
  const response = await fetch(deepgramListenUrl(), {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": normalized.type || "application/octet-stream",
    },
    body: Buffer.from(await normalized.arrayBuffer()),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Deepgram transcription failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }

  const payload = await response.json() as DeepgramResponse;
  const alternative = payload.results?.channels?.[0]?.alternatives?.[0];
  return {
    text: alternative?.transcript?.trim() || "",
    duration: payload.metadata?.duration,
    segments: {
      provider: "deepgram",
      model: deepgramModel(),
      confidence: alternative?.confidence,
      words: alternative?.words,
      paragraphs: alternative?.paragraphs,
    },
  };
}
