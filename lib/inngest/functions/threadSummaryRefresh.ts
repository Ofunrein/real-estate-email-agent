import {
  readEventsForThreadFromDatabase,
  upsertThreadSummaryInDatabase,
} from "@/lib/database";
import { inngest } from "@/lib/inngest/client";

function compactSummary(events: Awaited<ReturnType<typeof readEventsForThreadFromDatabase>>): string {
  return events
    .slice(-8)
    .map((event) => {
      const who = event.direction === "inbound" ? "Lead" : (event.agent_name || "Agent");
      const text = String(event.message_text || event.summary || "").replace(/\s+/g, " ").trim();
      return text ? `${who}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 1600);
}

export const threadSummaryRefresh = inngest.createFunction(
  {
    id: "thread-summary-refresh",
    name: "Refresh thread summary",
    triggers: [{ event: "thread.summary.refresh" }],
  },
  async ({ event, step }) => {
    const threadRef = String(event.data?.threadRef || "").trim();
    const channel = String(event.data?.channel || "").trim();
    if (!threadRef) return { ok: false, error: "missing_thread_ref" };

    const events = await step.run("load thread events", async () => {
      return readEventsForThreadFromDatabase(threadRef, 30);
    });
    const summary = compactSummary(events);

    await step.run("upsert thread summary", async () => {
      await upsertThreadSummaryInDatabase({
        threadRef,
        channel,
        summary,
        messageCount: events.length,
        lastMessageAt: events.at(-1)?.event_at || "",
        model: "deterministic-v1",
      });
    });

    return { ok: true, threadRef, messageCount: events.length };
  },
);
