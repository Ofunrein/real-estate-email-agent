import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
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

function m4aFilename(name: string): string {
  return name.replace(/\.(webm|ogg)$/i, ".m4a") || `manual-voice-note-${Date.now()}.m4a`;
}

export async function normalizeManualVoiceUpload(file: File): Promise<File> {
  if (!shouldTranscodeForSmsAudio(file)) return file;
  if (!ffmpegPath) throw new Error("Audio conversion is not available on this server");

  const id = randomUUID();
  const inputPath = join(tmpdir(), `${id}.webm`);
  const outputPath = join(tmpdir(), `${id}.m4a`);

  try {
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));
    await execFileAsync(ffmpegPath, [
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
    ]);
    const converted = await readFile(outputPath);
    return new File([converted], m4aFilename(file.name), { type: "audio/mp4" });
  } finally {
    await Promise.allSettled([
      rm(inputPath, { force: true }),
      rm(outputPath, { force: true }),
    ]);
  }
}
