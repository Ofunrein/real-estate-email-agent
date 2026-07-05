import { normalizeGeneratedVoiceNote } from "@/lib/audioTranscode";
import { saveMediaUpload } from "@/lib/mediaUploads";

const CARTESIA_VERSION = process.env.CARTESIA_VERSION || "2026-03-01";

type CartesiaCloneResponse = {
  id?: string;
  voice_id?: string;
  _id?: string;
  name?: string;
  title?: string;
  status?: string;
  state?: string;
};

function cartesiaApiKey(): string {
  return process.env.CARTESIA_API_KEY || "";
}

export function cartesiaAudioEnabled(): boolean {
  return Boolean(cartesiaApiKey());
}

function cartesiaVoiceId(inputVoiceId?: string): string {
  return inputVoiceId
    || process.env.CARTESIA_VOICE_ID
    || process.env.CARTESIA_REFERENCE_ID
    || process.env.CARTESIA_DEFAULT_VOICE_ID
    || "";
}

function cartesiaHeaders(extra?: HeadersInit): HeadersInit {
  const apiKey = cartesiaApiKey();
  if (!apiKey) throw new Error("CARTESIA_API_KEY is required");
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-API-Key": apiKey,
    "Cartesia-Version": CARTESIA_VERSION,
    ...extra,
  };
}

function audioFilename(prefix: string, extension = "mp3"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
}

async function cartesiaErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown };
    const detail = payload.error || payload.message || payload.detail;
    if (typeof detail === "string" && detail.trim()) return `${fallback}: ${detail.trim().slice(0, 240)}`;
  } catch {
    // Plain-text API errors are common for multipart validation.
  }
  return `${fallback}: ${text.trim().slice(0, 240)}`;
}

export async function cloneCartesiaVoice(input: {
  title: string;
  files: File[];
  description?: string;
  language?: string;
}): Promise<{ id: string; title: string; state?: string }> {
  if (!input.files.length) throw new Error("At least one voice sample is required");

  const form = new FormData();
  form.set("clip", input.files[0]);
  form.set("name", input.title.trim() || "Lumenosis cloned voice");
  form.set("language", input.language || process.env.CARTESIA_CLONE_LANGUAGE || "en");
  if (input.description?.trim()) form.set("description", input.description.trim());

  const response = await fetch("https://api.cartesia.ai/voices/clone", {
    method: "POST",
    headers: cartesiaHeaders(),
    body: form,
  });
  if (!response.ok) {
    throw new Error(await cartesiaErrorMessage(response, `Cartesia voice clone failed (${response.status})`));
  }
  const payload = await response.json().catch(() => ({})) as CartesiaCloneResponse;

  const id = payload.id || payload.voice_id || payload._id || "";
  if (!id) throw new Error("Cartesia voice clone did not return a voice id");
  return {
    id,
    title: payload.name || payload.title || input.title,
    state: payload.state || payload.status,
  };
}

export async function createCartesiaVoiceNote(input: {
  text: string;
  voiceId?: string;
  requestUrl: string;
  threadRef?: string;
 smsCompatible?: boolean;
}): Promise<{ url: string; filename: string; contentType: string; storage: string }> {
  const text = input.text.trim();
  if (!text) throw new Error("Voice note text is required");
  const voiceId = cartesiaVoiceId(input.voiceId);
  if (!voiceId) throw new Error("CARTESIA_VOICE_ID or a cloned voice id is required");

  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: cartesiaHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model_id: process.env.CARTESIA_TTS_MODEL_ID || "sonic-2",
      transcript: text,
      voice: {
        mode: "id",
        id: voiceId,
      },
      output_format: {
        container: "mp3",
        bit_rate: 128000,
        sample_rate: 44100,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await cartesiaErrorMessage(response, `Cartesia voice note failed (${response.status})`));
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const filename = audioFilename("cartesia-voice-note", "mp3");
  const file = new File([bytes], filename, { type: "audio/mpeg" });
  const uploaded = await saveMediaUpload({
    file,
    threadRef: input.threadRef || "cartesia-voice-note",
    requestUrl: input.requestUrl,
  });
  return { url: uploaded.url, filename: uploaded.filename, contentType: file.type || "audio/mpeg", storage: uploaded.storage };
}
