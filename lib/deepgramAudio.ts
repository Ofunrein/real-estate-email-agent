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

  const response = await fetch(deepgramListenUrl(), {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: Buffer.from(await file.arrayBuffer()),
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
