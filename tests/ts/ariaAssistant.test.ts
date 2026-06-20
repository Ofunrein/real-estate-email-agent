import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAriaAssistant } from "@/lib/ariaAssistant";
import { resolveClientConfig } from "@/lib/clientConfig";

function config() {
  return resolveClientConfig({
    CLIENT_NAME: "Acme Realty",
    HUMAN_TRANSFER_NUMBER: "+15128152032",
    ARIA_VOICE_ID: "voice-xyz",
  });
}

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    const next = values[key];
    if (next == null) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return run();
  } finally {
    for (const key of Object.keys(values)) {
      const old = previous[key];
      if (old == null) delete process.env[key];
      else process.env[key] = old;
    }
  }
}

test("buildAriaAssistant: uses only Vapi-native inline call controls", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com/", secret: "s3cr3t" });
  const model = assistant.model as Record<string, unknown>;
  const tools = model.tools as Array<Record<string, unknown>>;
  assert.equal(tools.length, 3);
  assert.deepEqual(tools.map((t) => t.type), ["voicemail", "transferCall", "endCall"]);
  assert.equal(model.toolIds, undefined);
  assert.match(String(assistant.voicemailMessage), /I also sent you a quick text/);
  assert.deepEqual(assistant.voicemailDetection, {
    provider: "vapi",
    backoffPlan: {
      maxRetries: 8,
      startAtSeconds: 1,
      frequencySeconds: 2.5,
    },
    beepMaxAwaitSeconds: 20,
  });
});

test("buildAriaAssistant: transferCall destination is the human transfer number", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  const tools = (assistant.model as Record<string, unknown>).tools as Array<Record<string, unknown>>;
  const transfer = tools.find((t) => t.type === "transferCall");
  assert.ok(transfer, "transferCall tool present");
  assert.equal((transfer!.function as Record<string, unknown>).name, "transferToHuman");
  const destinations = transfer!.destinations as Array<Record<string, unknown>>;
  assert.equal(destinations[0].number, "+15128152032");
  const endCall = tools.find((t) => t.type === "endCall");
  assert.ok(endCall, "endCall tool present");
  assert.equal((endCall!.function as Record<string, unknown>).name, "endCall");
});

test("buildAriaAssistant: sends final call reports to the app lifecycle webhook", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com", secret: "k" });
  assert.deepEqual(assistant.server, { url: "https://app.example.com/api/webhooks/aria-voice?secret=k" });
  assert.deepEqual(assistant.serverMessages, ["end-of-call-report"]);
});

test("buildAriaAssistant: keeps saved first message inbound-safe", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  assert.equal(assistant.firstMessage, "Thanks for calling Acme Realty, this is Iris. How can I help?");
  assert.equal(assistant.firstMessageMode, "assistant-speaks-first");
  assert.doesNotMatch(String(assistant.firstMessage), /\{\{#|{%\s*if/i);
});

test("buildAriaAssistant: custom voice id wired, system prompt branded", () => {
  const assistant = withEnv({ ARIA_VOICE_PROVIDER: undefined, ARIA_VOICE_MODEL: undefined }, () =>
    buildAriaAssistant(config(), { publicUrl: "https://app.example.com" }),
  );
  const voice = assistant.voice as Record<string, unknown>;
  assert.equal(voice.voiceId, "voice-xyz");
  assert.equal(voice.provider, "11labs");
  assert.equal(voice.model, "eleven_flash_v2_5");
  assert.deepEqual(voice.fallbackPlan, { voices: [{ provider: "openai", voiceId: "alloy", model: "tts-1" }] });
  const messages = (assistant.model as Record<string, unknown>).messages as Array<Record<string, string>>;
  assert.match(messages[0].content, /Acme Realty/);
  assert.match(messages[0].content, /checkAvailability/);
  assert.match(messages[0].content, /bookConsultation/);
  assert.match(messages[0].content, /sendBookingSmsConfirmation/);
  assert.match(messages[0].content, /notifySlackLeadIssue/);
  assert.match(messages[0].content, /getCallerContext/);
  assert.match(messages[0].content, /shared omnichannel brain/);
  assert.match(messages[0].content, /recent Iris conversations across every channel/);
  assert.match(messages[0].content, /searchProperties/);
  assert.match(messages[0].content, /lookupProperty/);
  assert.match(messages[0].content, /sendPropertyDetailsSms/);
  assert.match(messages[0].content, /leaveVoicemail/);
  assert.match(messages[0].content, /also sent a text/);
  assert.match(messages[0].content, /OPERATING PRINCIPLES/);
  assert.match(messages[0].content, /Direction over script/);
  assert.match(messages[0].content, /not canned rebuttals/);
  assert.match(messages[0].content, /confirm fit, confirm contact details/);
  assert.match(messages[0].content, /what properties do you have available/i);
  assert.match(messages[0].content, /never use SMS or email as the substitute/i);
  assert.match(messages[0].content, /Critical-info confirmation/);
  assert.match(messages[0].content, /spell it back letter by letter/);
  assert.match(messages[0].content, /B as in Bravo/);
  assert.match(messages[0].content, /Do not send a confirmation until the caller says it is correct/);
  assert.match(messages[0].content, /weekday, date, time, and time zone/);
  assert.match(messages[0].content, /one zero zero four/);
  assert.match(messages[0].content, /greater Austin \/ Central Texas metro/);
  assert.match(messages[0].content, /mile markers/);
  assert.match(messages[0].content, /preferred follow-up channel/);
  assert.match(messages[0].content, /transferToHuman|transfer/i);
  assert.match(messages[0].content, /\{\{call\.type\}\}/);
  assert.match(messages[0].content, /outbound openers are resolved before POST \/call/i);
});

test("buildAriaAssistant: sets Vapi response delay", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  assert.deepEqual(assistant.startSpeakingPlan, { waitSeconds: 0.5 });
});

test("buildAriaAssistant: supports ElevenLabs low-latency voice tuning", () => {
  const assistant = withEnv(
    {
      ARIA_VOICE_PROVIDER: "11labs",
      ARIA_VOICE_MODEL: "eleven_turbo_v2_5",
      ARIA_VOICE_OPTIMIZE_STREAMING_LATENCY: "4",
      ARIA_VOICE_STABILITY: "0.5",
      ARIA_VOICE_SIMILARITY_BOOST: "0.75",
      ARIA_VOICE_STYLE: "0.1",
      ARIA_VOICE_SPEED: "1.05",
      ARIA_VOICE_USE_SPEAKER_BOOST: "true",
      ARIA_VOICE_FALLBACK_PROVIDER: undefined,
      ARIA_VOICE_FALLBACK_ID: undefined,
      ARIA_VOICE_FALLBACK_MODEL: undefined,
    },
    () => buildAriaAssistant(config(), { publicUrl: "https://app.example.com" }),
  );
  const voice = assistant.voice as Record<string, unknown>;
  assert.deepEqual(voice, {
    provider: "11labs",
    voiceId: "voice-xyz",
    fallbackPlan: { voices: [{ provider: "openai", voiceId: "alloy", model: "tts-1" }] },
    model: "eleven_turbo_v2_5",
    optimizeStreamingLatency: 4,
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.1,
    speed: 1.05,
    useSpeakerBoost: true,
  });
});

test("buildAriaAssistant: allows explicit fallback voice for Vapi publish validation", () => {
  const assistant = withEnv(
    {
      ARIA_VOICE_PROVIDER: "openai",
      ARIA_VOICE_FALLBACK_PROVIDER: "openai",
      ARIA_VOICE_FALLBACK_ID: "echo",
      ARIA_VOICE_FALLBACK_MODEL: "tts-1",
    },
    () => buildAriaAssistant(config(), { publicUrl: "https://app.example.com" }),
  );
  const voice = assistant.voice as Record<string, unknown>;
  assert.deepEqual(voice.fallbackPlan, { voices: [{ provider: "openai", voiceId: "echo", model: "tts-1" }] });
});

test("buildAriaAssistant: qualifyLead captures channel and bed-bath preferences", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  const tools = (assistant.model as Record<string, unknown>).tools as Array<Record<string, unknown>>;
  assert.ok(!tools.some((t) => (t.function as Record<string, unknown> | undefined)?.name === "qualifyLead"));
  const messages = (assistant.model as Record<string, unknown>).messages as Array<Record<string, string>>;
  assert.match(messages[0].content, /preferred follow-up channel/);
  assert.match(messages[0].content, /bedroom\/bathroom/);
  assert.match(messages[0].content, /sell before buying/);
});

test("buildAriaAssistant: no voice block when voiceId unset", () => {
  const bare = resolveClientConfig({ HUMAN_TRANSFER_NUMBER: "+15128152032" });
  const assistant = buildAriaAssistant(bare, { publicUrl: "https://app.example.com" });
  assert.equal(assistant.voice, undefined);
});

test("buildAriaAssistant: appends styleContext to system prompt when provided", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com", styleContext: "VOICE_SAMPLE_BLOCK" });
  const messages = (assistant.model as Record<string, unknown>).messages as Array<Record<string, string>>;
  assert.match(messages[0].content, /VOICE_SAMPLE_BLOCK/);
});

test("buildAriaAssistant: no style text when styleContext absent", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  const messages = (assistant.model as Record<string, unknown>).messages as Array<Record<string, string>>;
  assert.ok(!messages[0].content.includes("VOICE_SAMPLE_BLOCK"));
});

test("buildAriaAssistant: defaults to matching OpenAI provider for GPT models", () => {
  const assistant = buildAriaAssistant(config(), { publicUrl: "https://app.example.com" });
  const model = assistant.model as Record<string, unknown>;
  assert.equal(model.provider, "openai");
  assert.equal(model.model, "gpt-4.1-mini");
});

test("buildAriaAssistant: allows explicit Anthropic model/provider override", () => {
  const assistant = buildAriaAssistant(config(), {
    publicUrl: "https://app.example.com",
    respondProvider: "anthropic",
    respondModel: "claude-sonnet-4-5",
  });
  const model = assistant.model as Record<string, unknown>;
  assert.equal(model.provider, "anthropic");
  assert.equal(model.model, "claude-sonnet-4-5");
});
