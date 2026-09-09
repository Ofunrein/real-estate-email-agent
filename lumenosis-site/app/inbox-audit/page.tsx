import type { Metadata } from "next";
import { InboxAudit } from "@/components/inbox-audit";

export const metadata: Metadata = {
  title: "Inbox Coverage Audit",
  description: "Find the lead-response gaps in your real estate team's inbox coverage.",
  alternates: { canonical: "/inbox-audit" },
  robots: { index: false, follow: false },
};

export default function InboxAuditPage() {
  return <InboxAudit />;
}
