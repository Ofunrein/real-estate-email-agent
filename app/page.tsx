import { AgentInboxClient } from "@/components/AgentInboxClient";
import { auth, isAllowedAuthEmail } from "@/auth";
import { loadAgentInboxData } from "@/lib/dataSource";
import { databaseEnabled } from "@/lib/database";
import { composeInboxData } from "@/lib/inboxData";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();

  if (!isAllowedAuthEmail(session?.user?.email)) {
    redirect("/login");
  }

  try {
    const { leads, events, properties, voiceCalls } = await loadAgentInboxData();
    const sourceLabel = databaseEnabled() ? "Database" : "Google Sheets";
    return (
      <AgentInboxClient
        data={composeInboxData(leads, events, properties, voiceCalls)}
        initialRefreshedAt={new Date().toISOString()}
        sourceLabel={sourceLabel}
        userEmail={session?.user?.email ?? ""}
      />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return (
      <AgentInboxClient
        data={composeInboxData([], [], [])}
        initialRefreshedAt={new Date().toISOString()}
        loadError={message}
        userEmail={session?.user?.email ?? ""}
      />
    );
  }
}
