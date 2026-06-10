// Vapi server-webhook parsing helpers. Vapi posts a single `{ message: {...} }`
// envelope to the assistant's server URL for every server event. The two we act
// on in Phase 1 are tool calls (mid-conversation function calls) and the
// end-of-call report (final transcript/recording/disposition).
//
// Vapi has shipped two tool-call shapes over time; we read both:
//   new:    message.type === "tool-calls", message.toolCallList[] = {id, function:{name, arguments}}
//   legacy: message.type === "function-call", message.functionCall = {name, parameters}
// and we always reply in the new `{ results: [{ toolCallId, result }] }` shape,
// which Vapi accepts for both.

export type VapiToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type VapiEndOfCall = {
  callId: string;
  phone: string;
  transcript: string;
  recordingUrl: string;
  summary: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  endedReason: string;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      return asObject(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return asObject(raw);
}

export function messageType(payload: Record<string, unknown>): string {
  const message = asObject(payload.message);
  return String(message.type || payload.type || "");
}

export type VapiCallMeta = {
  callId: string;
  phone: string;
  threadRef: string;
};

// Caller identity for a tool-call payload: number + call id → voice thread ref.
export function parseCallMeta(payload: Record<string, unknown>): VapiCallMeta {
  const message = asObject(payload.message);
  const call = asObject(message.call || payload.call);
  const customer = asObject(call.customer || message.customer || payload.customer);
  const phone = String(customer.number || message.phoneNumber || payload.phone || "");
  const callId = String(call.id || message.callId || payload.callId || phone || "unknown");
  return { callId, phone, threadRef: `voice:${callId}` };
}

// Extract every tool call in the payload, normalized to {id, name, args}.
export function parseToolCalls(payload: Record<string, unknown>): VapiToolCall[] {
  const message = asObject(payload.message);

  const list = Array.isArray(message.toolCallList)
    ? message.toolCallList
    : Array.isArray(message.toolCalls)
      ? message.toolCalls
      : Array.isArray((payload as { toolCalls?: unknown[] }).toolCalls)
        ? (payload as { toolCalls: unknown[] }).toolCalls
        : [];

  if (list.length) {
    return list.map((entry) => {
      const call = asObject(entry);
      const fn = asObject(call.function);
      return {
        id: String(call.id || call.toolCallId || ""),
        name: String(fn.name || call.name || ""),
        args: parseArgs(fn.arguments ?? fn.parameters ?? call.arguments ?? call.parameters),
      };
    }).filter((call) => call.name);
  }

  // legacy single function-call
  const fn = asObject(message.functionCall || payload.functionCall);
  if (fn.name) {
    return [{
      id: String(message.toolCallId || ""),
      name: String(fn.name),
      args: parseArgs(fn.parameters ?? fn.arguments),
    }];
  }
  return [];
}

// Format tool results for the Vapi response body.
export function formatToolResults(results: Array<{ id: string; result: string }>): { results: Array<{ toolCallId: string; result: string }> } {
  return { results: results.map((entry) => ({ toolCallId: entry.id, result: entry.result })) };
}

export function parseEndOfCallReport(payload: Record<string, unknown>): VapiEndOfCall {
  const message = asObject(payload.message);
  const call = asObject(message.call || payload.call);
  const customer = asObject(call.customer || message.customer);
  const artifact = asObject(message.artifact);

  const startedAt = String(message.startedAt || call.startedAt || "");
  const endedAt = String(message.endedAt || call.endedAt || "");
  const explicitDuration = Number(message.durationSeconds || message.duration || 0);
  const computedDuration = startedAt && endedAt
    ? Math.max(0, (Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
    : 0;

  return {
    callId: String(call.id || message.callId || payload.callId || ""),
    phone: String(customer.number || message.phoneNumber || ""),
    transcript: String(message.transcript || artifact.transcript || ""),
    recordingUrl: String(message.recordingUrl || artifact.recordingUrl || call.recordingUrl || ""),
    summary: String(message.summary || artifact.summary || ""),
    startedAt,
    endedAt,
    durationSec: explicitDuration > 0 ? explicitDuration : computedDuration,
    endedReason: String(message.endedReason || call.endedReason || ""),
  };
}
