import assert from "node:assert/strict";
import test from "node:test";

import { isTranscribableMedia, normalizeManualVoiceUpload, normalizeMediaForTranscription, normalizeVoiceCloneSample } from "@/lib/audioTranscode";

test("manual browser voice upload falls back when ffmpeg cannot decode the webm", async () => {
  const file = new File([Buffer.from("not a real webm")], "manual-voice-note-test.webm", { type: "audio/webm" });

  const normalized = await normalizeManualVoiceUpload(file);

  assert.equal(normalized.name, file.name);
  assert.equal(normalized.type, file.type);
  assert.equal(Buffer.from(await normalized.arrayBuffer()).toString(), "not a real webm");
});

test("voice clone sample falls back when browser webm cannot be transcoded", async () => {
  const file = new File([Buffer.from("not a real clone sample")], "operator-sample.webm", { type: "audio/webm" });

  const normalized = await normalizeVoiceCloneSample(file);

  assert.equal(normalized.name, file.name);
  assert.equal(normalized.type, file.type);
  assert.equal(Buffer.from(await normalized.arrayBuffer()).toString(), "not a real clone sample");
});


test("transcription media accepts video files and falls back safely when ffmpeg cannot decode", async () => {
  const file = new File([Buffer.from("not real mp4")], "lead-reel.mp4", { type: "video/mp4" });
  assert.equal(isTranscribableMedia(file), true);
  const normalized = await normalizeMediaForTranscription(file);
  assert.equal(normalized.name, file.name);
  assert.equal(normalized.type, file.type);
});
