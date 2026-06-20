#!/usr/bin/env node
import fs from "node:fs";

import { handleAriaEndOfCall } from "../lib/ariaWebhook.ts";

const VAPI_BASE = "https://api.vapi.ai";

function loadEnv(path = ".env") {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    process.env[key] = value;
  }
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function vapiRequest(path, apiKey) {
  const response = await fetch(`${VAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Vapi ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function endOfCallPayload(call) {
  return {
    message: {
      type: "end-of-call-report",
      call: {
        id: call.id,
        customer: call.customer,
        startedAt: call.startedAt || call.createdAt || "",
        endedAt: call.endedAt || call.updatedAt || "",
        endedReason: call.endedReason || "",
        recordingUrl: call.recordingUrl || call.artifact?.recordingUrl || "",
      },
      startedAt: call.startedAt || call.createdAt || "",
      endedAt: call.endedAt || call.updatedAt || "",
      endedReason: call.endedReason || "",
      summary: call.summary || call.analysis?.summary || call.artifact?.summary || "",
      transcript: call.transcript || call.artifact?.transcript || "",
      recordingUrl: call.recordingUrl || call.artifact?.recordingUrl || "",
      artifact: {
        recordingUrl: call.artifact?.recordingUrl || call.recordingUrl || "",
        transcript: call.artifact?.transcript || call.transcript || "",
        messages: call.artifact?.messages || call.messages || [],
      },
    },
  };
}

loadEnv();

const apiKey = process.env.VAPI_API_KEY;
if (!apiKey) throw new Error("Missing VAPI_API_KEY");

const limit = Number(argValue("--limit", "25"));
const assistantId = argValue("--assistant-id", process.env.VAPI_ASSISTANT_ID || "");
const dryRun = process.argv.includes("--dry-run");

const list = asArray(await vapiRequest(`/call?limit=${Math.max(1, limit)}`, apiKey));
const candidates = list
  .filter((call) => call?.id)
  .filter((call) => !assistantId || call.assistantId === assistantId || call.assistant?.id === assistantId);

let logged = 0;
for (const item of candidates) {
  const call = await vapiRequest(`/call/${item.id}`, apiKey);
  if (call.status && call.status !== "ended") continue;
  if (dryRun) {
    console.log(JSON.stringify({
      call_id: call.id,
      phone: call.customer?.number || "",
      started_at: call.startedAt || call.createdAt || "",
      ended_at: call.endedAt || call.updatedAt || "",
      ended_reason: call.endedReason || "",
      has_transcript: Boolean(call.transcript || call.artifact?.transcript || call.messages?.length || call.artifact?.messages?.length),
      has_recording: Boolean(call.recordingUrl || call.artifact?.recordingUrl),
    }));
    continue;
  }
  const saved = await handleAriaEndOfCall(endOfCallPayload(call));
  logged += 1;
  console.log(JSON.stringify({ logged: saved.call_id, phone: saved.phone, ended_reason: saved.ended_reason }));
}

console.log(JSON.stringify({ ok: true, dry_run: dryRun, checked: candidates.length, logged }));
