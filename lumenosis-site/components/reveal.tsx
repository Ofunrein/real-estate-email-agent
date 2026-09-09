"use client";

import type { HTMLAttributes, ReactNode } from "react";

type RevealVariant = "up" | "left" | "right" | "scale" | "fade";

interface RevealProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: RevealVariant;
  delay?: number;
  duration?: number;
  className?: string;
}

// Static passthrough. Entry motion is owned by the scroll choreography layer
// (components/motion/scroll-experience.tsx); extra props (e.g. data-motion)
// are forwarded so the director can target these wrappers.
export function Reveal({ children, variant, delay, duration, className, ...rest }: RevealProps) {
  void variant;
  void delay;
  void duration;

  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}
