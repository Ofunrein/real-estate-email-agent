import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    href: "/admin/demos",
    title: "Demo rooms",
    body: "Generate, approve and send prospect demo rooms on the public site.",
  },
];

/**
 * Platform-administration landing page.
 *
 * Deliberately thin. The command-center analytics view still renders inside the
 * tenant dashboard for this release (dual path), so nothing is moved here yet;
 * this page only introduces the `/admin` surface and links onward.
 */
export default async function AdminOverviewPage() {
  const viewer = await requirePlatformAdmin();

  return (
    <section className="admin-page">
      <h1 className="admin-page-title">Platform administration</h1>
      <p className="admin-page-lede">
        Internal operator surface for {viewer.workspaceName}. Not visible to tenants.
      </p>
      <ul className="admin-card-grid">
        {SECTIONS.map((section) => (
          <li key={section.href} className="admin-card">
            <Link href={section.href} className="admin-card-link">
              <span className="admin-card-title">{section.title}</span>
              <span className="admin-card-body">{section.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
