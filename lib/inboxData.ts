import type { SheetRow } from "@/lib/sheetSchema";

export type Channel = "email" | "sms" | "whatsapp" | "voice" | "website_chat" | "unknown";

export type AgentInboxData = {
  leads: SheetRow[];
  events: SheetRow[];
  properties: SheetRow[];
  metrics: ReturnType<typeof buildMetrics>;
  threads: Record<string, SheetRow[]>;
  propertyHealth: ReturnType<typeof buildPropertyHealth>;
};

export function channelFor(event: SheetRow): Channel {
  const channel = (event.channel || "unknown").toLowerCase();
  if (["email", "sms", "whatsapp", "voice", "website_chat"].includes(channel)) {
    return channel as Channel;
  }
  return "unknown";
}

export function groupEventsByThread(events: SheetRow[]): Record<string, SheetRow[]> {
  return events.reduce<Record<string, SheetRow[]>>((groups, event) => {
    const key = event.thread_ref || event.email || event.phone || "unknown";
    groups[key] ||= [];
    groups[key].push(event);
    return groups;
  }, {});
}

export function buildMetrics(leads: SheetRow[], events: SheetRow[]) {
  const channels = events.reduce<Record<string, number>>((counts, event) => {
    const channel = channelFor(event);
    counts[channel] = (counts[channel] || 0) + 1;
    return counts;
  }, {});
  const needsHumanLeads = leads.filter((lead) => lead.handoff_status === "needs_human").length;
  const needsHumanEvents = events.filter((event) => event.status === "needs_human").length;
  const outboundReplies = events.filter((event) => event.direction === "outbound").length;
  const inboundMessages = events.filter((event) => event.direction === "inbound").length;
  return {
    lead_count: leads.length,
    event_count: events.length,
    property_count: 0,
    needs_human: needsHumanLeads + needsHumanEvents,
    inbound_messages: inboundMessages,
    outbound_replies: outboundReplies,
    channels,
  };
}

export function buildPropertyHealth(properties: SheetRow[]) {
  const missingCore = properties.filter(
    (property) => !property.sqft || !property.year_built || !property.zip || !property.photo_url,
  );
  const duplicateCounts = properties.reduce<Record<string, number>>((counts, property) => {
    const key = (property.address || "").split(",", 1)[0].trim().toLowerCase();
    if (key) {
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, {});
  const duplicateGroups = Object.values(duplicateCounts).filter((count) => count > 1).length;
  return {
    total: properties.length,
    missing_core: missingCore.length,
    duplicate_groups: duplicateGroups,
  };
}

export function composeInboxData(leads: SheetRow[], events: SheetRow[], properties: SheetRow[]): AgentInboxData {
  const metrics = buildMetrics(leads, events);
  metrics.property_count = properties.length;
  return {
    leads,
    events,
    properties,
    metrics,
    threads: groupEventsByThread(events),
    propertyHealth: buildPropertyHealth(properties),
  };
}
