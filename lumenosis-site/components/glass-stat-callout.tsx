import type { ReactNode } from "react";

export function GlassStatCallout({
  label,
  value,
  icon,
  className,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-none flex items-center gap-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-bg-cream)]/92 px-3 py-2.5 text-[var(--color-ink-charcoal)] shadow-[var(--shadow-soft)] backdrop-blur-md dark:bg-black/75 dark:border-white/10 ${className ?? ""}`}
    >
      {icon && (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-brand-violet-soft)] text-[var(--color-brand-violet)] dark:bg-white/10 dark:text-white/80">
          <span className="[&>svg]:size-3.5">{icon}</span>
        </div>
      )}
      <div>
        <div className="text-[13px] font-semibold leading-tight">{value}</div>
        <div className="mt-0.5 text-[9px] uppercase tracking-widest text-[var(--color-muted)] dark:text-white/50">
          {label}
        </div>
      </div>
    </div>
  );
}
