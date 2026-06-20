import { sendTheoSms } from "@/lib/twilioSms";

export async function handleAgentSmsControl(from: string, body: string): Promise<void> {
  if (process.env.ENABLE_ARIA_SMS_CONTROL !== "true") return;
  const agentPhone = process.env.AGENT_PHONE || "";
  if (!agentPhone || from !== agentPhone) return;

  const command = body.trim().toLowerCase();
  if (command === "help") {
    await sendTheoSms(from, "Iris commands:\nstatus\npause\nresume\ncall +1xxxxxxxxxx\nhelp");
    return;
  }
  if (command === "status") {
    await sendTheoSms(from, `Iris outbound: ${process.env.ARIA_OUTBOUND_PAUSED === "true" ? "PAUSED" : "ACTIVE"}`);
    return;
  }
  if (command === "pause") {
    process.env.ARIA_OUTBOUND_PAUSED = "true";
    await sendTheoSms(from, "Iris outbound paused for 30 min.");
    setTimeout(() => {
      process.env.ARIA_OUTBOUND_PAUSED = "false";
    }, 30 * 60 * 1000);
    return;
  }
  if (command === "resume") {
    process.env.ARIA_OUTBOUND_PAUSED = "false";
    await sendTheoSms(from, "Iris outbound resumed.");
    return;
  }
  if (command.startsWith("call ")) {
    const number = command.replace("call ", "").trim();
    if (!/^\+1\d{10}$/.test(number)) {
      await sendTheoSms(from, "Invalid number. Use E.164: +1xxxxxxxxxx");
      return;
    }
    const apiKey = process.env.VAPI_API_KEY || "";
    const assistantId = process.env.VAPI_ASSISTANT_ID || process.env.ARIA_ASSISTANT_ID || "";
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID || process.env.ARIA_PHONE_NUMBER_ID || "";
    if (!apiKey || !assistantId || !phoneNumberId) {
      await sendTheoSms(from, "Iris is not fully configured.");
      return;
    }
    const response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ assistantId, phoneNumberId, customer: { number } }),
    });
    await sendTheoSms(from, response.ok ? `Iris calling ${number} now.` : `Failed: ${response.status}`);
    return;
  }

  await sendTheoSms(from, "Unknown command. Text help for options.");
}
