import { planCadenceQueue, type CadenceQueuePlan, type LeadWithEvents } from "@/lib/cadenceQueue";
import { clientConfig } from "@/lib/clientConfig";
import { persistCadenceQueuePlanInDatabase, readEventsForThreadFromDatabase } from "@/lib/database";
import type { SheetRow } from "@/lib/sheetSchema";

export function cadenceTasksEnabled(): boolean {
  return process.env.ENABLE_CADENCE_TASKS !== "false";
}

export function planCadenceForLead(input: {
  lead: Partial<SheetRow>;
  events: SheetRow[];
  nowMs?: number;
  timezone?: string;
}): CadenceQueuePlan {
  return planCadenceQueue({
    leads: [{ lead: input.lead, events: input.events } satisfies LeadWithEvents],
    config: clientConfig().cadence,
    nowMs: input.nowMs || Date.now(),
    timezone: input.timezone || process.env.CALENDAR_TIMEZONE || "America/Chicago",
  });
}

export async function scheduleCadenceAfterInteraction(input: {
  lead: Partial<SheetRow>;
  event: SheetRow;
}): Promise<CadenceQueuePlan | null> {
  if (!cadenceTasksEnabled()) return null;
  const threadRef = input.event.thread_ref || input.event.phone || input.event.email || "";
  const events = threadRef ? await readEventsForThreadFromDatabase(threadRef, 50) : [input.event];
  const plan = planCadenceForLead({ lead: input.lead, events });
  await persistCadenceQueuePlanInDatabase(plan, {
    trigger: "channel_interaction",
    threadRef,
    eventType: input.event.event_type || "",
    direction: input.event.direction || "",
  });
  return plan;
}
