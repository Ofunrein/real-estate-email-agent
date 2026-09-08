import type { Metadata } from "next";
import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lumenosis platform administration",
  description: "Internal platform administration.",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/demos", label: "Demos" },
];

/**
 * Shell for the platform-administration surface.
 *
 * The guard runs in the layout so every current and future `/admin/*` route is
 * gated by default — a new page cannot accidentally ship unauthenticated. Child
 * pages still call `requirePlatformAdmin()` themselves when they need the viewer,
 * which is cheap and keeps each route independently safe to read.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requirePlatformAdmin();

  return (
    <div className="admin-shell">
      <header className="admin-shell-header">
        <div className="admin-shell-brand">
          <span className="admin-shell-title">Platform administration</span>
          <span className="admin-shell-badge">Internal</span>
        </div>
        <nav className="admin-shell-nav" aria-label="Platform administration">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="admin-shell-nav-link">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="admin-shell-viewer">
          {/* Workspace name only. No email, no tenant PII in the chrome. */}
          <span>{viewer.workspaceName}</span>
          <Link href="/" className="admin-shell-nav-link">
            Exit to dashboard
          </Link>
        </div>
      </header>
      <main className="admin-shell-main">{children}</main>
    </div>
  );
}
