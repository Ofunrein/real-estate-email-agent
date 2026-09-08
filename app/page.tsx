import { InboxApp } from "@/components/inbox-mui/InboxApp";
import { opaqueAnalyticsId } from "@/lib/analyticsIdentity";
import { requireCommandCenterViewer } from "@/lib/authGuard";
import { composeInboxData } from "@/lib/inboxData";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewer = await requireCommandCenterViewer();
  if (!viewer) redirect("/login");

  return (
    <InboxApp
      data={composeInboxData([], [], [], [])}
      isPlatformAdmin={viewer.role === "platform_admin"}
      analyticsIdentity={{
        distinctId: opaqueAnalyticsId(`${viewer.role}:${viewer.workspaceId}`),
        tenantId: viewer.workspaceId,
        viewerRole: viewer.role,
      }}
    />
  );
}
