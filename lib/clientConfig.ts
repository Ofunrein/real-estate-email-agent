import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";

// Per-client customization layer. Resolved by client_id from env today;
// a DB/file source can back this later without changing consumers.
// Drives the Iris brand voice, custom Vapi voice, CRM/calendar wiring,
// cadence pacing, notify prefs, and few-shot style-training toggles.
//
// resolveClientConfig() takes an env record so it is pure and unit-testable.
// clientConfig() is the process.env-backed convenience used at runtime.

export type CadenceConfig = {
  maxTouches: number;
  minGapHours: number;
  stopOnReply: boolean;
  oneChannelPerDay: boolean;
  // legal/quiet call window in the lead's local time (24h)
  callWindowStartHour: number;
  callWindowEndHour: number;
};

export type NotifyConfig = {
  // agent quiet-hours (local), inclusive start, exclusive end
  quietStartHour: number;
  quietEndHour: number;
  preferredChannel: "sms" | "email" | "dashboard";
};

export type StyleTrainingConfig = {
  enabled: boolean;
  limit: number;
};

export type ClientConfig = {
  clientId: string;
  clientName: string;
  voiceClientName: string;
  agentNames: { email: string; sms: string; voice: string; chat: string };
  brandVoice: string;
  voiceId: string;
  crmProvider: string;
  calendarId: string;
  humanTransferNumber: string;
  cadence: CadenceConfig;
  notify: NotifyConfig;
  styleTraining: StyleTrainingConfig;
};

type Env = Record<string, string | undefined>;

function str(env: Env, key: string, fallback = ""): string {
  const value = env[key];
  return value == null || value === "" ? fallback : value;
}

function int(env: Env, key: string, fallback: number): number {
  const parsed = Number.parseInt(str(env, key), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(env: Env, key: string, fallback = false): boolean {
  const value = str(env, key).trim().toLowerCase();
  if (value === "") return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function channel(value: string, fallback: NotifyConfig["preferredChannel"]): NotifyConfig["preferredChannel"] {
  return value === "sms" || value === "email" || value === "dashboard" ? value : fallback;
}

export function resolveClientConfig(env: Env = process.env): ClientConfig {
  const clientId = str(env, "CLIENT_ID", "default");
  const clientName = str(env, "CLIENT_NAME", clientId);
  const teamName = str(env, "TEAM_NAME", clientName);

  return {
    clientId,
    clientName,
    voiceClientName: str(env, "ARIA_CLIENT_NAME", teamName),
    agentNames: {
      email: str(env, "AGENT_NAME_EMAIL", IRIS_AGENT_NAME),
      sms: str(env, "AGENT_NAME_SMS", IRIS_AGENT_NAME),
      voice: str(env, "AGENT_NAME_VOICE", IRIS_AGENT_NAME),
      chat: str(env, "AGENT_NAME_CHAT", IRIS_AGENT_NAME),
    },
    brandVoice: str(env, "BRAND_VOICE", `Warm, concise, professional. Represents ${teamName}.`),
    voiceId: str(env, "ARIA_VOICE_ID"),
    crmProvider: str(env, "CRM_PROVIDER", "ghl").toLowerCase(),
    calendarId: str(env, "GHL_CALENDAR_ID"),
    humanTransferNumber: str(env, "HUMAN_TRANSFER_NUMBER"),
    cadence: {
      maxTouches: int(env, "CADENCE_MAX_TOUCHES", 14),
      minGapHours: int(env, "CADENCE_MIN_GAP_HOURS", 48),
      stopOnReply: bool(env, "CADENCE_STOP_ON_REPLY", true),
      oneChannelPerDay: bool(env, "CADENCE_ONE_CHANNEL_PER_DAY", true),
      callWindowStartHour: int(env, "CADENCE_CALL_WINDOW_START_HOUR", 8),
      callWindowEndHour: int(env, "CADENCE_CALL_WINDOW_END_HOUR", 21),
    },
    notify: {
      quietStartHour: int(env, "NOTIFY_QUIET_START_HOUR", 21),
      quietEndHour: int(env, "NOTIFY_QUIET_END_HOUR", 8),
      preferredChannel: channel(str(env, "NOTIFY_PREFERRED_CHANNEL", "sms"), "sms"),
    },
    styleTraining: {
      enabled: bool(env, "ENABLE_STYLE_TRAINING", false),
      limit: int(env, "STYLE_TRAINING_EXAMPLES_LIMIT", 3),
    },
  };
}

export function clientConfig(): ClientConfig {
  return resolveClientConfig(process.env);
}
