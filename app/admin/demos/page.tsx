import type { Metadata } from "next";
import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/adminGuard";
import {
  type DemoAdminResult,
  type DemoSummary,
  demoDataSource,
  listDemos,
} from "@/lib/demoAdminClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Demo rooms",
  robots: { index: false, follow: false },
};

/**
 * Platform-admin demo management (decision B5: never tenant-visible).
 *
 * After cutover (DEMO_DATA_OWNER=postgres) this reads this app's own Neon database
 * directly — no outbound request to lumenosis.com. Before cutover it reads the signed
 * platform API on lumenosis.com, which is the compatibility path. Either way it shows no
 * placeholder or sample rows: an operator must never be able to mistake fixture data for
 * real prospect state.
 */
export default async function AdminDemosPage() {
  await requirePlatformAdmin();
  const result = await listDemos();
  const source = demoDataSource();

  return (
    <section className="admin-panel">
      <header className="admin-panel__head">
        <div>
          <h1>Demo rooms</h1>
          <p className="admin-panel__sub">
            Generate, approve, and send prospect demo rooms. Links use the existing
            public <code>lumenosis.com/demo/&lt;token&gt;</code> format, so every URL already
            sent to a prospect keeps working unchanged.
          </p>
        </div>
        <Link className="admin-panel__back" href="/admin">
          Back to admin
        </Link>
      </header>

      {result.ok ? (
        <DemoTable demos={result.data.demos} />
      ) : (
        <Unavailable result={result} source={source} />
      )}
    </section>
  );
}

function Unavailable({
  result,
  source,
}: {
  result: Extract<DemoAdminResult<unknown>, { ok: false }>;
  source: "postgres" | "platform-api";
}) {
  const copy = {
    not_configured:
      source === "postgres"
        ? {
            title: "Demo database is not configured",
            body:
              "DEMO_DATA_OWNER is set to postgres but DATABASE_URL is missing, or the email provider key is unset for a send. Nothing is read or written until both are present.",
          }
        : {
            title: "Demo management is not connected yet",
            body:
              "This panel reads from the demo API on lumenosis.com during the compatibility window. Set LUMENOSIS_PLATFORM_API_URL and LUMENOSIS_PLATFORM_API_SECRET, or complete the cutover and set DEMO_DATA_OWNER=postgres to read this app's own database with no outbound request.",
          },
    unauthorized: {
      title: "Demo API rejected this app's credentials",
      body:
        "The request was signed but refused. Confirm LUMENOSIS_PLATFORM_API_SECRET matches the value configured on lumenosis.com. No demo data is shown while the signature is untrusted.",
    },
    unavailable: {
      title:
        source === "postgres" ? "Demo data could not be read" : "Demo API is unreachable",
      body: result.detail ?? "The demo data source did not respond. Nothing has been changed.",
    },
  }[result.reason];

  return (
    <div className="admin-notice" role="status">
      <strong>{copy.title}</strong>
      <p>{copy.body}</p>
      <p className="admin-notice__foot">
        The existing shared-password surface at <code>lumenosis.com/admin/demos</code> remains
        available during the compatibility window and becomes read-only after cutover.
      </p>
    </div>
  );
}

function DemoTable({ demos }: { demos: DemoSummary[] }) {
  if (!demos.length) {
    return (
      <div className="admin-notice" role="status">
        <strong>No demo rooms yet</strong>
        <p>Generated demos will appear here once the first prospect room is created.</p>
      </div>
    );
  }

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th scope="col">Prospect</th>
          <th scope="col">Listing</th>
          <th scope="col">Demo</th>
          <th scope="col">Outreach</th>
          <th scope="col">Link</th>
        </tr>
      </thead>
      <tbody>
        {demos.map((demo) => (
          <tr key={demo.id}>
            <td>
              <strong>{demo.fullName}</strong>
              <span className="admin-table__meta">
                {demo.businessName}
                {demo.emailDomain ? ` · @${demo.emailDomain}` : ""}
              </span>
            </td>
            <td>{demo.address}</td>
            <td>
              <span className={`admin-badge admin-badge--${demo.status}`}>{demo.status}</span>
            </td>
            <td>
              <span className={`admin-badge admin-badge--${demo.outreachStatus}`}>
                {demo.outreachStatus}
              </span>
            </td>
            <td>
              <a href={demo.demoUrl} rel="noreferrer noopener" target="_blank">
                Open demo
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
