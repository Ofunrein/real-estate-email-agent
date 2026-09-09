import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-violet)] focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--color-brand-violet)] text-white hover:bg-[var(--color-brand-violet)]/80",
        secondary:
          "border-transparent bg-[var(--color-brand-violet-soft)] text-[var(--color-brand-violet)] hover:bg-[var(--color-brand-violet-soft)]/80",
        destructive:
          "border-transparent bg-red-500 text-white hover:bg-red-600",
        outline: "text-[var(--color-ink-charcoal)] border-[var(--color-line)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
