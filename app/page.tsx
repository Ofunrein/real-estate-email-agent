import { InboxApp } from "@/components/inbox-mui/InboxApp";
import { auth, isAllowedAuthEmail, localAuthBypassEnabled } from "@/auth";
import { loadAgentInboxData } from "@/lib/dataSource";
import { composeInboxData } from "@/lib/inboxData";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const TEAM_NAME = process.env.TEAM_NAME || process.env.CLIENT_NAME || "";

export default async function Home() {
  const session = await auth();
  const localBypass = localAuthBypassEnabled();

  if (!localBypass && !isAllowedAuthEmail(session?.user?.email)) {
    redirect("/login");
  }

  try {
    const { leads, events, properties, voiceCalls } = await loadAgentInboxData();
    return (
      <InboxApp
        data={composeInboxData(leads, events, properties, voiceCalls)}
        teamName={TEAM_NAME}
        userEmail={session?.user?.email ?? (localBypass ? "local-dev@lumenosis.test" : "")}
      />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Google Sheets data.";
    return (
      <InboxApp
        data={composeInboxData([], [], [])}
        loadError={message}
        teamName={TEAM_NAME}
        userEmail={session?.user?.email ?? (localBypass ? "local-dev@lumenosis.test" : "")}
      />
    );
  }
}
