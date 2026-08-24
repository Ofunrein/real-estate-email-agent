import { recordChannelInteraction } from "@/lib/channelIngest";
import { claimDueCadenceTasksInDatabase, completeCadenceTaskInDatabase, failCadenceTaskInDatabase, findLeadInDatabase } from "@/lib/database";
import { inngest } from "@/lib/inngest/client";
import { sendManualReply } from "@/lib/manualReply";
import { IRIS_AGENT_NAME } from "@/lib/agentIdentity";
import { channelSuppression, type SuppressibleChannel } from "@/lib/contactSuppression";

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

        // Re-read the lead at SEND time. `task.lead` is a snapshot frozen when
        // the task was queued, so a STOP that arrived after queueing is not in
        // it. Cancel-on-inbound is a race mitigation, not a gate: a task
        // already claimed into `running`, or one whose lead_identity does not
        // match the STOP write, would otherwise still send.
        const storedLead = await findLeadInDatabase(
          channel === "email" ? { email: to } : { phone: to },
        ).catch(() => null);
        const suppression = channelSuppression(storedLead ?? undefined, channel as SuppressibleChannel);
        if (suppression.suppressed) {
          await completeCadenceTaskInDatabase(task.id, { skipped_send: suppression.code, to });
          results.push({ id: task.id, channel, skipped: suppression.code });
          continue;
        }

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
