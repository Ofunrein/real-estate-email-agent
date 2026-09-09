import type { MDXComponents } from "mdx/types";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: (props) => (
      <h1
        className="font-[family-name:var(--font-display)] text-[length:var(--text-display-section)] font-semibold text-[var(--color-ink-charcoal)]"
        {...props}
      />
    ),
    h2: (props) => (
      <h2
        className="mt-10 font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--color-ink-charcoal)]"
        {...props}
      />
    ),
    p: (props) => <p className="mt-4 text-[var(--color-muted)]" {...props} />,
    ul: (props) => <ul className="mt-4 list-disc space-y-2 pl-6 text-[var(--color-muted)]" {...props} />,
    ...components,
  };
}
