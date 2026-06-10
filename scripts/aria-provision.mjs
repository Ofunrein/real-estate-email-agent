// Create or update Aria's Vapi assistant from lib/ariaAssistant.ts (config-as-code).
// Run: npm run aria:provision            (create or update)
//      npm run aria:provision -- --dry-run   (print the assistant JSON only)
//
// Env: VAPI_API_KEY (required), VAPI_ASSISTANT_ID (update if set, else create),
//      PUBLIC_BASE_URL or VERCEL_URL (tool/server webhook base), CHANNEL_WEBHOOK_SECRET.
import { resolveClientConfig } from "../lib/clientConfig.ts";
import { buildAriaAssistant } from "../lib/ariaAssistant.ts";
import { fetchStyleContext } from "../lib/styleTraining.ts";

const VAPI_BASE = "https://api.vapi.ai";

function publicBaseUrl() {
  const explicit = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL || "";
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const apiKey = process.env.VAPI_API_KEY || "";
  const assistantId = process.env.VAPI_ASSISTANT_ID || "";
  const publicUrl = publicBaseUrl();
  const secret = process.env.CHANNEL_WEBHOOK_SECRET || "";

  if (!publicUrl) {
    console.error("Set PUBLIC_BASE_URL (or VERCEL_URL) so Vapi can reach the tool webhooks.");
    process.exit(1);
  }

  const config = resolveClientConfig(process.env);
  if (!config.humanTransferNumber) {
    console.error("Set HUMAN_TRANSFER_NUMBER (live transfer destination) before provisioning.");
    process.exit(1);
  }

  const assistant = buildAriaAssistant(config, { publicUrl, secret, styleContext: await fetchStyleContext().catch(() => "") });

  if (dryRun) {
    console.log(JSON.stringify(assistant, null, 2));
    return;
  }

  if (!apiKey) {
    console.error("VAPI_API_KEY is required to provision the assistant. Use --dry-run to preview.");
    process.exit(1);
  }

  const url = assistantId ? `${VAPI_BASE}/assistant/${assistantId}` : `${VAPI_BASE}/assistant`;
  const method = assistantId ? "PATCH" : "POST";
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(assistant),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Vapi ${method} failed (${response.status}):`, JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  const id = payload.id || assistantId;
  console.log(`${assistantId ? "Updated" : "Created"} Aria assistant: ${id}`);
  if (!assistantId) {
    console.log(`Set VAPI_ASSISTANT_ID=${id} and bind a Vapi phone number to this assistant.`);
  }
  console.log(`Transfer destination: ${config.humanTransferNumber}`);
  console.log(`Tool webhook base: ${publicUrl}/api/webhooks/aria-tools/<name>`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
