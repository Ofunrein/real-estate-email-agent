import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-line)] py-8">
      <div className="mx-auto flex w-[min(1120px,calc(100vw-40px))] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Image src="/images/lumenosis-logo-warm.png" alt="Lumenosis AI" width={24} height={24} className="rounded-md opacity-80" />
          <span className="text-[0.8125rem] text-[var(--color-muted)]">&copy; {new Date().getFullYear()} Lumenosis AI</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-5">
          {[
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
            { label: "Request a Demo", href: "#book" },
            { label: "hello@lumenosis.com", href: "mailto:hello@lumenosis.com" },
          ].map((link) => (
            link.href.startsWith("/") ? (
              <Link key={link.label} href={link.href}
                className="text-[0.8125rem] text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-amber)]">
                {link.label}
              </Link>
            ) : (
              <a key={link.label} href={link.href}
                className="text-[0.8125rem] text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors">
                {link.label}
              </a>
            )
          ))}
        </nav>
      </div>
    </footer>
  );
}
