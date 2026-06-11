import { AgentInboxClient } from "@/components/AgentInboxClient";
import { loadAgentInboxData } from "@/lib/dataSource";
import { databaseEnabled } from "@/lib/database";
import { composeInboxData } from "@/lib/inboxData";

export const dynamic = "force-dynamic";

export default async function Home() {
  try {
    const { leads, events, properties, voiceCalls } = await loadAgentInboxData();
    const sourceLabel = databaseEnabled() ? "Database" : "Google Sheets";
    return (
      <AgentInboxClient
        data={composeInboxData(leads, events, properties, voiceCalls)}
        initialRefreshedAt={new Date().toISOString()}
        sourceLabel={sourceLabel}
      />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return (
      <AgentInboxClient
        data={composeInboxData([], [], [])}
        initialRefreshedAt={new Date().toISOString()}
        loadError={message}
      />
    );
  }
}
