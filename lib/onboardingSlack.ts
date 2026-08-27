import { plannedPrivateChannels, type OnboardingIntake } from "@/lib/onboarding";

type SlackResult = { ok: boolean; channel?: { id?: string }; error?: string };
async function slack(action: string, body: Record<string, unknown>): Promise<SlackResult> {
  const token = process.env.SLACK_BOT_TOKEN || "";
  if (!token) throw new Error("SLACK_BOT_TOKEN is required");
  const response = await fetch(`https://slack.com/api/${action}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as SlackResult;
  if (!response.ok || !data.ok) throw new Error(`Slack ${action} failed: ${data.error || response.status}`);
  return data;
}

export async function createOnboardingSlackChannels(intake: OnboardingIntake): Promise<Record<string, string>> {
  const created: Record<string, string> = {};
  for (const name of plannedPrivateChannels(intake)) {
    let channelId = "";
    try {
      channelId = (await slack("conversations.create", { name, is_private: true })).channel?.id || "";
    } catch (error) {
      if (!String(error).includes("name_taken")) throw error;
      const list = await slack("conversations.list", { exclude_archived: true, limit: 200, types: "private_channel" }) as SlackResult & { channels?: { id: string; name: string }[] };
      channelId = list.channels?.find((channel) => channel.name === name)?.id || "";
      if (!channelId) throw error;
    }
    created[name] = channelId;
    await slack("chat.postMessage", { channel: channelId, text: `Iris onboarding workspace created for ${intake.company_name}.`, blocks: [
      { type: "header", text: { type: "plain_text", text: "Iris onboarding workspace ready" } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Client*\n${intake.company_name}` },
        { type: "mrkdwn", text: `*Owner*\n${intake.primary_contact_name}` },
        { type: "mrkdwn", text: `*Inbox*\n${intake.mailbox_address || "Pending"}` },
        { type: "mrkdwn", text: `*Systems*\n${intake.systems_to_connect || "Pending review"}` },
      ] },
      { type: "context", elements: [{ type: "mrkdwn", text: "No passwords or reusable credentials belong in this channel. Use OAuth, delegated invitations, or an expiring vault handoff." }] },
    ] });
  }
  return created;
}
