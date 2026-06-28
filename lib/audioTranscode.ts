import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

function shouldTranscodeForSmsAudio(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return (type === "audio/webm" || type === "video/webm" || name.endsWith(".webm"))
    && name.includes("manual-voice-note");
}

function shouldTranscodeForVoiceClone(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  return type === "audio/webm"
    || type === "video/webm"
    || type === "audio/ogg"
    || name.endsWith(".webm")
    || name.endsWith(".ogg");
}

function m4aFilename(name: string, prefix = "manual-voice-note"): string {
  const converted = name.replace(/\.(webm|ogg)$/i, ".m4a");
  return converted === name ? `${prefix}-${Date.now()}.m4a` : converted;
}

async function resolveFfmpegPath(): Promise<string> {
  const candidates = [
    ffmpegPath,
    join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate; bundled serverless paths can differ by build mode.
    }
  }
  throw new Error("Audio conversion is not available on this server");
}

async function transcodeToM4a(file: File, prefix: string): Promise<File> {
  let executable = "";
  try {
    executable = await resolveFfmpegPath();
  } catch {
    return file;
  }

  const id = randomUUID();
  const inputPath = join(tmpdir(), `${id}.webm`);
  const outputPath = join(tmpdir(), `${id}.m4a`);

  try {
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
    try {
      await execFileAsync(executable, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        outputPath,
      ], { timeout: 20_000, maxBuffer: 64 * 1024 });
    } catch {
      return file;
    }
    const converted = await readFile(outputPath);
    if (!converted.length) return file;
    return new File([converted], m4aFilename(file.name, prefix), { type: "audio/mp4" });
  } finally {
    await Promise.allSettled([
      rm(inputPath, { force: true }),
      rm(outputPath, { force: true }),
    ]);
  }
}

export async function normalizeManualVoiceUpload(file: File): Promise<File> {
  if (!shouldTranscodeForSmsAudio(file)) return file;
  return transcodeToM4a(file, "manual-voice-note");
}

export async function normalizeVoiceCloneSample(file: File): Promise<File> {
  if (!shouldTranscodeForVoiceClone(file)) return file;
  return transcodeToM4a(file, "voice-clone-sample");
}
