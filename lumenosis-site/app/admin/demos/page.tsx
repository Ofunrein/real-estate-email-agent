import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { emailHtml } from "@/lib/email-html";
import { sql } from "@/lib/turso";

export const dynamic = "force-dynamic";

type Demo = {
  id: string;
  full_name: string;
  business_name: string;
  email: string;
  address: string;
  status: string;
  access_token: string;
  subject: string;
  body: string;
  outreach_status: string;
  created_at: string;
};

export default async function DemoAdminPage() {
  if (!(await isAdmin())) redirect("/admin/demos/login");
  const demos = (await sql(`SELECT d.id, p.full_name, p.business_name, p.email, l.address, d.status,
    d.access_token, o.subject, o.body, o.status AS outreach_status, d.created_at
    FROM demo_rooms d JOIN prospects p ON p.id = d.prospect_id
    JOIN listings l ON l.id = d.listing_id JOIN outreach_drafts o ON o.demo_room_id = d.id
    ORDER BY d.created_at DESC`)) as Demo[];

  return (
    <main className="min-h-screen bg-[#0c0c0d] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#c49a52]">Lumenosis</p>
            <h1 className="mt-1 text-3xl font-semibold">Demo approvals</h1>
          </div>
          <span className="text-sm text-white/60">{demos.length} demos</span>
        </div>

        <nav className="sticky top-0 z-10 mt-6 flex gap-2 overflow-x-auto border-y border-white/10 bg-[#0c0c0d]/95 py-3 backdrop-blur">
          {demos.map((demo) => (
            <a
              key={demo.id}
              href={`#demo-${demo.id}`}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              {demo.full_name}
            </a>
          ))}
        </nav>

        <details className="mt-6 rounded-[12px] border border-white/10 bg-white/[0.04]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Create demo</summary>
          <form
            action="/api/admin/demos/generate"
            method="post"
            className="grid gap-3 border-t border-white/10 bg-[#f8f7f3] p-4 text-[#151515] md:grid-cols-2"
          >
            {[
              ["fullName", "Agent full name"],
              ["email", "Agent email"],
              ["businessName", "Team or brokerage"],
              ["listingAddress", "Active listing address"],
              ["listingUrl", "Listing URL"],
            ].map(([name, label]) => (
              <label key={name} className="text-sm font-medium">
                {label}
                <input
                  name={name}
                  type={name === "email" ? "email" : name === "listingUrl" ? "url" : "text"}
                  required
                  className="mt-2 w-full rounded-[9px] border border-black/15 bg-white px-3 py-3 text-base outline-none focus:border-[#c49a52]"
                />
              </label>
            ))}
            <label className="text-sm font-medium">
              Sender inbox
              <select
                name="senderInbox"
                className="mt-2 w-full rounded-[9px] border border-black/15 bg-white px-3 py-3 text-base"
              >
                <option>iris-demo@agentmail.to</option>
                <option>iris-outreach@agentmail.to</option>
                <option>olivia-outreach@agentmail.to</option>
                <option>aria-outreach@agentmail.to</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-[10px] bg-[#151515] px-5 py-3 font-semibold text-white md:col-span-2"
            >
              Research and generate draft
            </button>
          </form>
        </details>

        <div className="mt-6 grid gap-4">
          {demos.map((demo) => (
            <article
              id={`demo-${demo.id}`}
              key={demo.id}
              className="scroll-mt-16 rounded-[12px] bg-[#f8f7f3] p-4 text-[#151515]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#75571f]">
                    Demo {demo.status} · Email {demo.outreach_status}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">{demo.full_name}</h2>
                  <p className="mt-1 text-sm text-[#666]">
                    {demo.business_name} · {demo.address}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    className="rounded-[8px] border border-black/15 px-3 py-2 text-sm font-semibold"
                    href={`/demo/${demo.access_token}`}
                    target="_blank"
                  >
                    Open full demo
                  </Link>
                  {demo.status === "draft" ? (
                    <form action={`/api/admin/demos/${demo.id}/approve`} method="post">
                      <button
                        type="submit"
                        className="rounded-[8px] bg-[#151515] px-3 py-2 text-sm font-semibold text-white"
                      >
                        Approve demo
                      </button>
                    </form>
                  ) : null}
                  {demo.status === "approved" && demo.outreach_status === "draft" ? (
                    <form action={`/api/admin/demos/${demo.id}/send`} method="post">
                      <button
                        type="submit"
                        className="rounded-[8px] bg-[#c49a52] px-3 py-2 text-sm font-semibold text-black"
                      >
                        Send outreach
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
              <details className="mt-4 overflow-hidden rounded-[8px] border border-black/10 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                  Preview live demo and email
                </summary>
                <div className="grid border-t border-black/10 lg:grid-cols-[1.35fr_0.65fr]">
                  <iframe
                    title={`Live demo for ${demo.full_name}`}
                    src={`/demo/${demo.access_token}`}
                    className="h-[620px] w-full border-0"
                  />
                  <div className="border-t border-black/10 p-3 lg:border-t-0 lg:border-l">
                    <strong className="block px-1 text-sm">{demo.subject}</strong>
                    <iframe
                      title={`Email preview for ${demo.full_name}`}
                      srcDoc={emailHtml(demo.body)}
                      sandbox=""
                      className="mt-2 h-[560px] w-full rounded-[6px] border border-black/10"
                    />
                  </div>
                </div>
              </details>
            </article>
          ))}
          {!demos.length ? (
            <p className="rounded-[14px] border border-white/10 p-8 text-white/60">
              No drafts yet.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
