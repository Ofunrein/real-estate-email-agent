import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { FishAudioClient } from "fish-audio";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads");

function fishApiKey(): string {
  return process.env.FISH_API_KEY || process.env.FISH_AUDIO_API_KEY || "";
}

export function fishAudioEnabled(): boolean {
  return Boolean(fishApiKey());
}

export function createFishAudioClient(): FishAudioClient {
  const apiKey = fishApiKey();
  if (!apiKey) throw new Error("FISH_API_KEY or FISH_AUDIO_API_KEY is required");
  return new FishAudioClient({ apiKey });
}

function publicUploadUrl(filename: string): string {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return `${base}/uploads/${filename}`;
}

function audioFilename(prefix: string, extension = "mp3"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function createFishVoiceNote(input: {
  text: string;
  referenceId?: string;
}): Promise<{ url: string; filename: string; contentType: string }> {
  const text = input.text.trim();
  if (!text) throw new Error("Voice note text is required");
  const client = createFishAudioClient();
  const response = await client.textToSpeech.convert({
    text,
    reference_id: input.referenceId || process.env.FISH_REFERENCE_ID || process.env.FISH_AUDIO_REFERENCE_ID || undefined,
    format: "mp3",
  });
  const bytes = await streamToBuffer(response);
  const filename = audioFilename("voice-note", "mp3");
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, filename), bytes);
  return { url: publicUploadUrl(filename), filename, contentType: "audio/mpeg" };
}

export async function transcribeFishAudio(file: File): Promise<{
  text: string;
  duration?: number;
  segments?: unknown;
}> {
  const client = createFishAudioClient();
  const result = await client.speechToText.convert({
    audio: file,
    language: "en",
    ignore_timestamps: false,
  });
  return {
    text: result.text || "",
    duration: result.duration,
    segments: result.segments,
  };
}

export async function cloneFishVoice(input: {
  title: string;
  files: File[];
  texts?: string[];
}): Promise<{ id: string; title: string; state?: string }> {
  if (!input.files.length) throw new Error("At least one voice sample is required");
  const client = createFishAudioClient();
  const result = await client.voices.ivc.create({
    title: input.title.trim() || "Lumenosis cloned voice",
    train_mode: "fast",
    voices: input.files,
    texts: input.texts?.filter(Boolean),
    visibility: "private",
    enhance_audio_quality: true,
  });
  return {
    id: result._id || "",
    title: result.title || input.title,
    state: result.state,
  };
}
