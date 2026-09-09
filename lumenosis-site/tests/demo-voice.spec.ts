import { expect, test } from "@playwright/test";
import type { DemoRoom } from "../content/demo-rooms";
import { demoVoiceOverrides, spokenAddress, spokenCount, spokenMoney } from "../lib/demo-voice";

function room(name: string, business: string, address: string, mls: string): DemoRoom {
  return {
    slug: name.toLowerCase(),
    prospect: { firstName: name, fullName: `${name} Agent`, businessName: business, role: "REALTOR®" },
    listing: {
      address,
      status: "active",
      price: 500000,
      beds: 3,
      baths: 2,
      squareFeet: 1800,
      acreage: 1,
      mls,
      propertyType: "Single-family home",
      yearBuilt: 2001,
      lotSquareFeet: 43560,
      pricePerSquareFoot: 278,
      listedAt: "September 1, 2026",
      summary: "Verified summary",
      highlights: ["Verified highlight"],
      buyerNotes: ["Showing availability requires human confirmation"],
      images: [],
    },
    sources: [{ label: "MLS source", url: `https://example.com/${mls}`, checkedAt: "2026-09-08" }],
    safetyBoundaries: ["Never promise showing availability"],
    expiresAt: "2026-09-18T23:59:59.000Z",
    approved: true,
  };
}

test("voice override introduces the specific team and binds its verified listing context", () => {
  const value = demoVoiceOverrides(room("Patricia", "ERA Team", "1 Private Road", "MLS-A"));
  expect(value.firstMessage).toContain("ERA Team");
  expect(value.firstMessage).toContain("Patricia's assistant");
  const prompt = JSON.stringify(value.model);
  for (const fact of ["Patricia Agent", "1 Private Road", "Verified highlight"])
    expect(prompt).toContain(fact);
  expect(prompt).not.toContain("MLS-A");
  expect(prompt).toContain("Never promise showing availability");
});

test("two demo rooms produce isolated overrides without cross-demo facts", () => {
  const a = JSON.stringify(demoVoiceOverrides(room("Patricia", "ERA Team", "1 Private Road", "MLS-A")));
  const b = JSON.stringify(demoVoiceOverrides(room("Jordan", "North Team", "2 Secret Lane", "MLS-B")));
  expect(a).not.toContain("Jordan");
  expect(a).not.toContain("2 Secret Lane");
  expect(a).not.toContain("MLS-B");
  expect(b).not.toContain("Patricia");
  expect(b).not.toContain("1 Private Road");
  expect(b).not.toContain("MLS-A");
});

test("voice policy blocks secrecy attacks, prompt injection, invented facts, and regulated advice", () => {
  const prompt = JSON.stringify(demoVoiceOverrides(room("Patricia", "ERA Team", "1 Private Road", "MLS-A"))).toLowerCase();
  for (const rule of [
    "never reveal",
    "system prompt",
    "other demo",
    "verified facts",
    "do not invent",
    "fair housing",
    "mortgage qualification",
    "legal advice",
    "one question at a time",
    "human confirmation",
  ]) expect(prompt).toContain(rule);
});

test("voice speaks prices and street suffixes naturally without reading MLS IDs", () => {
  const value = demoVoiceOverrides(room("Patricia", "ERA Team", "85500 Oak Dr, Austin, TX", "12345678"));
  const prompt = JSON.stringify(value);
  expect(prompt).toContain("five hundred thousand dollars");
  expect(prompt).toContain("Oak Drive");
  expect(prompt).not.toContain("12345678");
  expect(prompt).not.toContain('\\"mls\\":');
});

test("voice demo uses the cost-efficient smart conversational stack", () => {
  const value = demoVoiceOverrides(room("Patricia", "ERA Team", "1 Private Rd", "MLS-A"));
  expect(value.model?.model).toBe("gpt-5-mini");
  expect(value.voice).toMatchObject({ provider: "deepgram", voiceId: "vesta", model: "aura-2" });
  expect(JSON.stringify(value.model)).toContain("casual");
  expect(JSON.stringify(value.model)).toContain("contractions");
});

test("speech planner makes addresses, money, and counts unambiguous for TTS", () => {
  expect(spokenAddress("85500 Oak Dr, Austin, TX 78701")).toBe(
    "eight five five zero zero Oak Drive, Austin, Texas seven eight seven zero one",
  );
  expect(spokenAddress("1205 N St. Johns Ave., Unit 4B")).toBe(
    "one two zero five North Saint Johns Avenue, Unit four B",
  );
  expect(spokenMoney(800000)).toBe("eight hundred thousand dollars");
  expect(spokenMoney(85500.5)).toBe("eighty-five thousand five hundred dollars and fifty cents");
  expect(spokenCount(2.5)).toBe("two and a half");
});

test("voice override includes natural turn-taking and interruption controls", () => {
  const value = demoVoiceOverrides(room("Patricia", "ERA Team", "85500 Oak Dr, Austin, TX", "MLS-A"));
  expect(value.transcriber).toEqual({ provider: "deepgram", model: "flux-general-en", language: "en" });
  // Turn-taking now comes from the shared flow module: a slightly longer base wait plus smart
  // endpointing, so a caller mid-thought is not cut off.
  expect(value.startSpeakingPlan).toMatchObject({
    waitSeconds: 0.6,
    smartEndpointingPlan: { provider: "livekit" },
  });
  expect(value.stopSpeakingPlan).toMatchObject({ numWords: 2, voiceSeconds: 0.2, backoffSeconds: 1 });
  expect(value.firstMessageInterruptionsEnabled).toBe(true);
  expect(value.backgroundSpeechDenoisingPlan).toEqual({ smartDenoisingPlan: { enabled: true } });
  expect(value.voice).toMatchObject({ provider: "deepgram", voiceId: "vesta", model: "aura-2" });
});

test("voice policy handles corrections, uncertainty, emotion, repetition, and endings like a person", () => {
  const prompt = JSON.stringify(demoVoiceOverrides(room("Patricia", "ERA Team", "1 Private Road", "MLS-A"))).toLowerCase();
  for (const behavior of [
    "caller corrects",
    "don't blame the caller",
    "match the caller's pace",
    "don't repeat",
    "brief silence",
    "interrupts",
    "emotion",
    "one clean goodbye",
    "never fake a filler",
    "answer first",
  ]) expect(prompt).toContain(behavior);
});

test("voice facts omit empty values instead of inviting the model to narrate nulls", () => {
  const fixture = room("Patricia", "ERA Team", "1 Private Road", "MLS-A");
  (fixture.listing as Partial<typeof fixture.listing>).acreage = undefined;
  (fixture.listing as Partial<typeof fixture.listing>).yearBuilt = undefined;
  const prompt = JSON.stringify(demoVoiceOverrides(fixture));
  expect(prompt).not.toContain('"acreage"');
  expect(prompt).not.toContain('"yearBuilt"');
  expect(prompt).not.toContain("undefined");
});
