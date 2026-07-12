import {
  readReplyJobByDedupeKeyFromDatabase,
  upsertReplyJobInDatabase,
} from "@/lib/database";
import { inngest } from "@/lib/inngest/client";
import { readEvents, readLeads, readProperties } from "@/lib/dataSource";
import { getTakeover } from "@/lib/humanTakeover";
import { buildLeadContextEnvelope, renderChannelReply } from "@/lib/leadContext";
import { runIrisConversationBrain } from "@/lib/irisConversationBrain";
import type { Channel } from "@/lib/inboxData";
import { notifySlackOnTransfer } from "@/lib/ariaSlack";

export const messageReplyGenerate = inngest.createFunction(
  {
    id: "message-reply-generate",
    name: "Generate omnichannel reply",
    triggers: [{ event: "message.reply.generate" }],
  },
  async ({ event, step }) => {
    const dedupeKey = String(event.data?.dedupeKey || "").trim();
    if (!dedupeKey) return { ok: false, error: "missing_dedupe_key" };

    const job = await step.run("load reply job", async () => {
      return readReplyJobByDedupeKeyFromDatabase(dedupeKey);
    });
    if (!job) return { ok: false, error: "reply_job_not_found" };
    if (job.status === "sent") return { ok: true, skipped: "already_sent" };
    if (job.status === "duplicate_suppressed") return { ok: true, skipped: "duplicate_suppressed" };

    const generated = await step.run("generate shared Iris decision", async () => {
      const [leads, allEvents, properties, takeover] = await Promise.all([
        readLeads(), readEvents(), readProperties(), getTakeover(job.threadRef, job.channel),
      ]);
      const events = allEvents.filter((row) => row.thread_ref === job.threadRef || row.phone === job.contactRef || row.email === job.contactRef).slice(-50);
      const lead = leads.find((row) => row.phone === job.contactRef || row.email === job.contactRef || events.some((event) => event.phone === row.phone || event.email === row.email)) || {};
      const providerMetadata = (job.metadata?.providerMetadata && typeof job.metadata.providerMetadata === "object")
        ? job.metadata.providerMetadata as Record<string, unknown> : {};
      const selectedProperties = properties.filter((property) => {
        const needle = JSON.stringify(providerMetadata.clicked_property || providerMetadata).toLowerCase();
        return Boolean(property.address) && (needle.includes(String(property.address).toLowerCase()) || String(lead.property_interest || "").toLowerCase().includes(String(property.address).toLowerCase()));
      }).slice(0, 5);
      const channel = job.channel as Channel;
      const context = buildLeadContextEnvelope({ channel, threadRef: job.threadRef, lead, events, provider: job.provider, providerMetadata, activeTakeover: takeover.isActive });
      const brain = runIrisConversationBrain({ channel: channel as Exclude<Channel, "voice" | "unknown">, threadRef: job.threadRef, latestMessage: events.at(-1)?.message_text || "", events, lead, properties: selectedProperties, context });
      return { brain, context, replyText: renderChannelReply(channel, brain.draft) };
    });

    await step.run("persist shared Iris decision", async () => {
      await upsertReplyJobInDatabase({
        dedupeKey,
        channel: job.channel,
        provider: job.provider,
        threadRef: job.threadRef,
        contactRef: job.contactRef,
        status: generated.brain.decision === "auto_send" ? "ready_to_send" : generated.brain.decision === "stop" ? "stopped" : generated.brain.needs_human ? "needs_human" : "drafted",
        modelClassify: "iris-shared-policy",
        modelReply: "iris-context-renderer",
        replyText: generated.replyText,
        nextAction: generated.brain.next_action,
        metadata: {
          decision: generated.brain.decision,
          confidence: generated.brain.confidence,
          reason: generated.brain.reason,
          contextFingerprint: generated.context.fingerprint,
          sourceAttribution: generated.context.source,
          handoffReason: generated.context.state.handoffReason,
          propertyContextUsed: generated.brain.property_context_used,
          generatedAt: new Date().toISOString(),
        },
      });
    });

    if (generated.brain.needs_human) {
      await step.run("alert human handoff", async () => notifySlackOnTransfer({
        outcome: "iris_handoff",
        caller_name: generated.context.identity.name,
        caller_phone: generated.context.identity.phone || generated.context.identity.email || job.contactRef || "unknown",
        channel: job.channel,
        timeline: generated.context.profile.timeline,
        property_address: String(generated.context.property.address || ""),
        notes: `${generated.brain.reason} ${generated.replyText}`.trim(),
        call_id: job.threadRef,
      }));
    }

    if (generated.brain.decision === "auto_send") {
      await step.sendEvent("queue safe reply send", { name: "message.reply.send", data: { dedupeKey } });
    }
    return { ok: true, status: generated.brain.decision, fingerprint: generated.context.fingerprint };
  },
);
