import { recordChannelInteraction } from "@/lib/channelIngest";
import { claimDueCadenceTasksInDatabase, completeCadenceTaskInDatabase, failCadenceTaskInDatabase } from "@/lib/database";
import { inngest } from "@/lib/inngest/client";
import { sendManualReply } from "@/lib/manualReply";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";

function clean(value: unknown): string {
  return String(value || "").trim();
}

function recipient(task: Awaited<ReturnType<typeof claimDueCadenceTasksInDatabase>>[number]): string {
  const lead = task.lead || {};
  if (task.channel === "email") return clean(lead.email);
  if (["sms", "voice", "whatsapp"].includes(task.channel)) return clean(lead.phone);
  const threadRef = clean(task.metadata.threadRef);
  return threadRef.includes(":") ? threadRef.split(":").slice(1).join(":") : threadRef;
}

function followupBody(task: Awaited<ReturnType<typeof claimDueCadenceTasksInDatabase>>[number]): string {
  const first = clean(task.lead.full_name).split(/\s+/)[0] || "there";
  if (task.reason === "speed_to_lead") return `Hey ${first}, this is Austin Realty. I saw your request and can help. Are you looking to buy, sell, or book a showing?`;
  return `Hey ${first}, quick follow-up from Austin Realty. Want me to send the best matching homes or help book a time?`;
}

export const cadenceTaskRun = inngest.createFunction(
  {
    id: "cadence-task-run",
    name: "Run due omnichannel follow-up tasks",
    triggers: [
      { event: "cadence.run" },
      { cron: "*/5 * * * *" },
    ],
  },
  async ({ step }) => {
    if (process.env.ENABLE_CADENCE_TASKS === "false") return { ok: true, skipped: "disabled" };
    const tasks = await step.run("claim due tasks", async () => claimDueCadenceTasksInDatabase(Number(process.env.CADENCE_TASK_BATCH_SIZE || "10")));
    const results: Record<string, unknown>[] = [];
    for (const task of tasks) {
      const to = recipient(task);
      const body = followupBody(task);
      if (!to || task.channel === "manual_human" || task.channel === "voice") {
        await completeCadenceTaskInDatabase(task.id, { skipped_send: task.channel === "manual_human" ? "manual_handoff" : "no_text_sender", to });
        results.push({ id: task.id, channel: task.channel, skipped: true });
        continue;
      }
      try {
        const channel = task.channel === "email" ? "email" : task.channel === "whatsapp" ? "whatsapp" : task.channel === "instagram" ? "instagram" : task.channel === "messenger" ? "messenger" : "sms";
        const sent = await sendManualReply({ channel, to, body });
        await recordChannelInteraction({
          channel,
          direction: "outbound",
          agentName: IRIS_AGENT_NAME,
          email: channel === "email" ? to : clean(task.lead.email),
          phone: ["sms", "whatsapp"].includes(channel) ? to : clean(task.lead.phone),
          fullName: clean(task.lead.full_name),
          source: "cadence",
          threadRef: clean(task.metadata.threadRef) || `${channel}:${to}`,
          eventType: "cadence_followup_sent",
          messageText: body,
          summary: `Cadence follow-up: ${body}`,
          preferredChannel: channel,
          aiAction: sent.ok ? "cadence_followup_sent" : "cadence_followup_failed",
          status: sent.ok ? "sent" : "send_failed",
          outcomeCode: sent.ok ? "" : sent.error,
        });
        if (sent.ok) await completeCadenceTaskInDatabase(task.id, { sent });
        else await failCadenceTaskInDatabase(task.id, sent.error || "send_failed");
        results.push({ id: task.id, channel, sent: sent.ok });
      } catch (error) {
        const message = error instanceof Error ? error.message : "cadence_send_failed";
        await failCadenceTaskInDatabase(task.id, message);
        results.push({ id: task.id, error: message });
      }
    }
    return { ok: true, claimed: tasks.length, results };
  },
);
