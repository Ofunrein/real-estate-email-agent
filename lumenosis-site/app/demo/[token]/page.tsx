import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoRoomExperience } from "@/components/demo-room-experience";
import { isAdmin } from "@/lib/admin-auth";
import { demoRoomForToken } from "@/lib/demo-room";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private Iris Demonstration",
  description: "A private Lumenosis AI demonstration.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function DemoRoomPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const match = await demoRoomForToken(token, await isAdmin());
  if (!match) notFound();

  if (match.expired) {
    return (
      <main
        id="top"
        className="flex min-h-screen items-center justify-center bg-[var(--color-bg-cream)] px-4 text-[var(--color-ink-charcoal)]"
      >
        <section className="max-w-xl rounded-[var(--radius)] border border-[var(--color-line)] bg-white p-8 text-center shadow-[var(--shadow-soft)]">
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.14em] text-[var(--color-brand-violet)]">
            Private demonstration
          </p>
          <h1 className="headline-plain mt-4 text-4xl">This demo has expired.</h1>
          <p className="mt-4 text-[var(--color-ink-muted)]">
            The public business information used by this demo is no longer guaranteed current.
          </p>
          <a
            className="mt-6 inline-block rounded-[var(--radius)] bg-[var(--color-brand-amber)] px-5 py-3 font-semibold text-black"
            href="https://lumenosis.com/#book"
          >
            Book a fresh walkthrough
          </a>
        </section>
      </main>
    );
  }

  return <DemoRoomExperience room={match.room} token={token} />;
}
