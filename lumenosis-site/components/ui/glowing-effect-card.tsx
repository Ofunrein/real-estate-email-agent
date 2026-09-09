"use client";
import React, { useRef, useCallback, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlowingEffectCardProps {
  children: ReactNode;
  className?: string;
  glowClassName?: string;
  disabled?: boolean;
}

export function GlowingEffectCard({ children, className, glowClassName, disabled = false }: GlowingEffectCardProps) {
  const divRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current || disabled) return;
    const rect = divRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    divRef.current.style.setProperty("--mouse-x", `${x}px`);
    divRef.current.style.setProperty("--mouse-y", `${y}px`);
  }, [disabled]);

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      className={cn(
        "group relative rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg-cream)] transition-colors",
        "before:absolute before:inset-0 before:rounded-2xl before:opacity-0 before:transition-opacity before:duration-500",
        "before:bg-[radial-gradient(600px_circle_at_var(--mouse-x,0px)_var(--mouse-y,0px),rgba(203,108,230,0.12),transparent_40%)]",
        "hover:before:opacity-100",
        "after:absolute after:inset-[-1px] after:rounded-2xl after:opacity-0 after:transition-opacity after:duration-500",
        "after:bg-[radial-gradient(400px_circle_at_var(--mouse-x,0px)_var(--mouse-y,0px),rgba(203,108,230,0.4),transparent_40%)]",
        "hover:after:opacity-100",
        "after:[mask:linear-gradient(#fff,#fff)_content-box,linear-gradient(#fff,#fff)] after:[mask-composite:exclude] after:p-px",
        className
      )}
    >
      <div className={cn("relative z-10 h-full w-full rounded-2xl p-6", glowClassName)}>
        {children}
      </div>
    </div>
  );
}
