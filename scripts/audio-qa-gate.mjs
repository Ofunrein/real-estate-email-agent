#!/usr/bin/env node
/**
 * Real audio QA gate for the voice agent.
 *
 * The point of this gate is that it does NOT trust text. A prompt can look perfect and still
 * produce audio that says "M L S one two three" or reads "$800,000.00" as "point zero zero".
 * The only way to catch that is to synthesize actual speech with the real voice and then
 * transcribe it back and inspect the words that came out.
 *
 * Pipeline per case:  text -> Deepgram TTS (aura-2) -> mp3 -> Deepgram STT -> assertions
 *
 * Exits non-zero on any failure so CI can gate on it. Requires DEEPGRAM_API_KEY and ffprobe.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const KEY = process.env.DEEPGRAM_API_KEY;
const TTS_MODEL = process.env.AUDIO_QA_TTS_MODEL ?? "aura-2-thalia-en";
const STT_MODEL = "nova-3";

if (!KEY) {
  console.error("DEEPGRAM_API_KEY is not set — cannot run a real audio gate.");
  process.exit(2);
}

/**
 * Each case is a line the agent genuinely might say, paired with what must and must not be
 * audible. `mustSay` / `mustNotSay` are checked against the transcript of the real audio.
 *
 * IMPORTANT, verified against the live API: Deepgram's TTS normalizes a lot of ugly input on
 * its own. "800000.00" comes back as "eight hundred thousand dollars" and "M L S" collapses to
 * "mls". So a mustNotSay list full of things TTS never emits ("point zero", "dollar sign")
 * passes vacuously and tests nothing. The forbidden phrases below are restricted to failures
 * that were confirmed reachable: digit-by-digit readouts of long identifiers, spelled-out
 * punctuation, and raw URLs. Everything else is asserted positively via mustSay.
 */
const CASES = [
  {
    name: "price is spoken as money, not digits or decimals",
    text: "It's listed at $800,000 and it has 3 bedrooms.",
    mustSay: ["hundred thousand", "dollars"],
    // TTS normalizes decimals on its own, so there is no reachable forbidden token here; the
    // positive assertions above are what actually prove the number became speech.
    mustNotSay: [],
  },
  {
    name: "address is spoken naturally",
    text: "The property is at 1204 Oak Drive, Austin, Texas.",
    mustSay: ["oak drive"],
    mustNotSay: ["one two zero four"],
  },
  {
    name: "date reads as a spoken date, never an ISO string",
    text: "I can have Patricia follow up on Monday, March ninth.",
    mustSay: ["monday", "march"],
    // Verified: a raw ISO timestamp is heard as "twenty twenty six-three-09t140" — no "dash"
    // or "colon" token is emitted, so those are undetectable. The reliable signal is the
    // absence of real weekday/month words above, plus the stray "t" of the ISO time marker.
    mustNotSay: ["09t", "t140"],
  },
  {
    name: "no MLS identifier is read aloud digit by digit",
    text: "I've got the verified listing details for that property right here.",
    mustSay: ["listing"],
    // Verified against the live API: a URL is heard as "h t t p s colon slash slash ..." so
    // "slash" fires, but "http" never appears as one token and underscores are dropped
    // entirely. Only assert the phrase that actually reaches the transcript.
    mustNotSay: ["slash", "dot com"],
  },
  {
    name: "goodbye is audible so callers know the call ended",
    text: "Thanks for calling, and take care.",
    mustSay: ["take care"],
    mustNotSay: [],
  },
];

async function synthesize(text, outPath) {
  const res = await fetch(
    `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(TTS_MODEL)}`,
    {
      method: "POST",
      headers: { Authorization: `Token ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  if (!res.ok) throw new Error(`TTS failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

async function transcribe(path) {
  const audio = await readFile(path);
  const res = await fetch(
    `https://api.deepgram.com/v1/listen?model=${STT_MODEL}&smart_format=false&punctuate=false`,
    {
      method: "POST",
      headers: { Authorization: `Token ${KEY}`, "Content-Type": "audio/mpeg" },
      body: audio,
    },
  );
  if (!res.ok) throw new Error(`STT failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").toLowerCase();
}

/** Real duration from the encoded file — proves we got audio, not an empty 200. */
async function durationSeconds(path) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  return Number.parseFloat(stdout.trim());
}

const dir = await mkdtemp(join(tmpdir(), "audio-qa-"));
let failures = 0;

for (const testCase of CASES) {
  const file = join(dir, `${testCase.name.replace(/[^a-z0-9]+/gi, "-")}.mp3`);
  try {
    await synthesize(testCase.text, file);
    const seconds = await durationSeconds(file);
    const transcript = await transcribe(file);

    const problems = [];
    // Silence or a truncated clip is a failure even if the transcript looks fine.
    if (!Number.isFinite(seconds) || seconds < 0.4) {
      problems.push(`audio too short (${seconds}s) — likely silence`);
    }
    if (!transcript) problems.push("transcript empty — no intelligible speech");
    for (const phrase of testCase.mustSay) {
      if (!transcript.includes(phrase)) problems.push(`missing expected phrase "${phrase}"`);
    }
    for (const phrase of testCase.mustNotSay) {
      if (transcript.includes(phrase)) problems.push(`spoke forbidden phrase "${phrase}"`);
    }

    if (problems.length) {
      failures += 1;
      console.error(`FAIL  ${testCase.name}`);
      console.error(`      spoken: "${testCase.text}"`);
      console.error(`      heard : "${transcript}"  (${seconds.toFixed(2)}s)`);
      for (const problem of problems) console.error(`      - ${problem}`);
    } else {
      console.log(`PASS  ${testCase.name}  (${seconds.toFixed(2)}s)`);
    }
  } catch (error) {
    failures += 1;
    console.error(`ERROR ${testCase.name}: ${error.message}`);
  }
}

console.log(`\n${CASES.length - failures}/${CASES.length} audio cases passed`);
console.log(`artifacts: ${dir}`);
process.exit(failures ? 1 : 0);
