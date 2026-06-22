import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads");
const CARTESIA_VERSION = "2026-03-01";

type CartesiaCloneResponse = {
  id?: string;
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
    "Cartesia-Version": CARTESIA_VERSION,
    ...extra,
  };
}

function publicUploadUrl(filename: string): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return `${base}/uploads/${filename}`;
}

function audioFilename(prefix: string, extension = "mp3"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
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
  form.set("language", input.language || "en");
  if (input.description?.trim()) form.set("description", input.description.trim());

  const response = await fetch("https://api.cartesia.ai/voices/clone", {
    method: "POST",
    headers: cartesiaHeaders(),
    body: form,
  });
  const payload = await response.json().catch(() => ({})) as CartesiaCloneResponse & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Cartesia voice clone failed (${response.status})`);
  }

  const id = payload.id || "";
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
}): Promise<{ url: string; filename: string; contentType: string }> {
  const text = input.text.trim();
  if (!text) throw new Error("Voice note text is required");
  const voiceId = cartesiaVoiceId(input.voiceId);
  if (!voiceId) throw new Error("CARTESIA_VOICE_ID or a cloned voice id is required");

  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: cartesiaHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model_id: process.env.CARTESIA_TTS_MODEL_ID || "sonic-3.5",
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
    const detail = await response.text().catch(() => "");
    throw new Error(`Cartesia voice note failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const filename = audioFilename("cartesia-voice-note", "mp3");
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, filename), bytes);
  return { url: publicUploadUrl(filename), filename, contentType: "audio/mpeg" };
}
