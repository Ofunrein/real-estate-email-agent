import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-violet)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-brand-violet)] text-white hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-violet)]",
        outline:
          "border border-[var(--color-line)] bg-transparent text-[var(--color-ink-charcoal)] hover:bg-[var(--color-bg-cream)] hover:-translate-y-0.5",
        ghost: "text-[var(--color-ink-charcoal)] hover:bg-[var(--color-bg-cream)]/60",
        ondark:
          "bg-white text-[var(--color-ink-charcoal)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]",
      },
      size: {
        default: "min-h-12 px-5 text-[15px]",
        sm: "min-h-10 px-4 text-sm",
        lg: "min-h-14 px-7 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
