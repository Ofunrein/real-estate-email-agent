import { planCadenceQueue, leadIdentity, type LeadWithEvents } from "@/lib/cadenceQueue";
import { clientConfig } from "@/lib/clientConfig";
import { persistCadenceQueuePlanInDatabase, readEventsFromDatabase, readLeadsFromDatabase } from "@/lib/database";
import { inngest } from "@/lib/inngest/client";
import type { SheetRow } from "@/lib/sheetSchema";

function eventKeys(event: Partial<SheetRow>): string[] {
  return [leadIdentity({ phone: event.phone }), leadIdentity({ email: event.email }), leadIdentity({ full_name: event.full_name })].filter(Boolean);
}

function leadsWithEvents(leads: SheetRow[], events: SheetRow[]): LeadWithEvents[] {
  const byIdentity = new Map<string, SheetRow[]>();
  for (const event of events) {
    for (const key of eventKeys(event)) {
      const bucket = byIdentity.get(key) || [];
      bucket.push(event);
      byIdentity.set(key, bucket);
    }
  }
  return leads.map((lead) => {
    const seen = new Set<SheetRow>();
    const matched: SheetRow[] = [];
    for (const key of eventKeys(lead)) {
      for (const event of byIdentity.get(key) || []) {
        if (seen.has(event)) continue;
        seen.add(event);
        matched.push(event);
      }
    }
    return { lead, events: matched };
  });
}

export const cadencePlan = inngest.createFunction(
  {
    id: "cadence-plan",
    name: "Plan persistent omnichannel follow-ups",
    triggers: [
      { event: "cadence.plan" },
      { cron: "*/15 * * * *" },
    ],
  },
  async ({ step }) => {
    if (process.env.ENABLE_CADENCE_TASKS === "false") return { ok: true, skipped: "disabled" };
    const [leads, events] = await step.run("load leads and events", async () => Promise.all([readLeadsFromDatabase(), readEventsFromDatabase()]));
    const config = clientConfig();
    const plan = planCadenceQueue({
      leads: leadsWithEvents(leads, events),
      config: config.cadence,
      nowMs: Date.now(),
      timezone: process.env.CALENDAR_TIMEZONE || "America/Chicago",
    });
    const saved = await step.run("persist cadence tasks", async () => persistCadenceQueuePlanInDatabase(plan, { trigger: "inngest_cadence_plan" }));
    return { ok: true, planned: plan.tasks.length, saved: saved.length, skipped: plan.skipped.length };
  },
);
