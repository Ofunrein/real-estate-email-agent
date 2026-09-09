import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AuroraBackground } from "@/components/aurora-background";
import { Footer } from "@/components/sections/footer";
import { Topbar } from "@/components/sections/topbar";
import { teamMembers } from "@/content/team";

export const metadata: Metadata = {
  title: "Team | Lumenosis AI",
  description: "Meet the family behind Lumenosis AI and the story that shaped the company.",
  alternates: { canonical: "/team" },
};

export default function TeamPage() {
  return (
    <>
      <AuroraBackground />
      <Topbar />
      <main className="relative min-h-screen pt-24 pb-16 md:pt-32 md:pb-24">
        <section className="mx-auto w-[min(1200px,calc(100%-32px))]">
          <div className="max-w-3xl">
            <span className="mb-3 inline-block text-[var(--text-eyebrow)] font-semibold uppercase tracking-[0.14em] text-[var(--color-brand-violet)]">
              Our team
            </span>
            <h1 className="headline-plain text-[var(--text-display-section)] text-[var(--color-ink)]">
              Family-built. Operator-focused.
            </h1>
            <p className="mt-6 max-w-2xl text-[var(--text-body-lg)] text-[var(--color-muted)]">
              Lumenosis began with one shared belief: real estate teams should never lose an opportunity because nobody was available to answer. The Ofunrein family is building the dependable AI front desk we wanted operators to have.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {teamMembers.map((member) => (
              <article
                key={member.name}
                className="rounded-[var(--radius)] border border-[var(--color-line)] bg-[var(--color-bg-cream)] p-6 shadow-[var(--shadow-soft)] md:p-8"
              >
                <div className="flex items-start gap-4">
                  <div className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-brand-amber-soft)] text-sm font-semibold text-[var(--color-ink)]">
                    <span>{member.initials}</span>
                    <Image
                      src={member.image}
                      alt={`${member.name} profile photo`}
                      fill
                      sizes="48px"
                      className="object-cover"
                    />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.02em] text-[var(--color-ink)]">
                      {member.name}
                    </h2>
                    <p className="mt-1 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-violet)]">
                      {member.role}
                    </p>
                  </div>
                </div>
                <p className="mt-6 text-[var(--color-muted)]">{member.bio}</p>
                {"linkedin" in member && member.linkedin ? (
                  <Link
                    href={member.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-6 inline-flex text-sm font-semibold text-[var(--color-ink)] underline decoration-[var(--color-brand-amber)] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-violet)] focus-visible:ring-offset-2"
                  >
                    LinkedIn profile
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
