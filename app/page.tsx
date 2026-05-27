import { AgentInboxClient } from "@/components/AgentInboxClient";
import { loadAgentInboxData } from "@/lib/googleSheets";
import { composeInboxData } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const { leads, events, properties } = await loadAgentInboxData();
    return <AgentInboxClient data={composeInboxData(leads, events, properties)} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return <AgentInboxClient data={composeInboxData([], [], [])} loadError={message} />;
  }
}
