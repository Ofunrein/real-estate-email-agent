import { InboxApp } from "@/components/inbox-mui/InboxApp";
import { auth, isAllowedAuthEmail, localAuthBypassEnabled } from "@/auth";
import { composeInboxData } from "@/lib/inboxData";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const TEAM_NAME = process.env.TEAM_NAME || process.env.CLIENT_NAME || "";

export default async function Home() {
  const session = await auth();
  const localBypass = localAuthBypassEnabled();
  if (!localBypass && !isAllowedAuthEmail(session?.user?.email)) redirect("/login");

  return (
    <InboxApp
      data={composeInboxData([], [], [], [])}
      teamName={TEAM_NAME}
      userEmail={session?.user?.email ?? (localBypass ? "local-dev@lumenosis.test" : "")}
    />
  );
}
