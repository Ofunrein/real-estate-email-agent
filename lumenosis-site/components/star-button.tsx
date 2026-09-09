"use client";
import type React from "react";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface StarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  lightWidth?: number;
  duration?: number;
  lightColor?: string;
  backgroundColor?: string;
  borderWidth?: number;
}

export function StarButton({
  children,
  lightWidth = 110,
  duration = 3,
  lightColor = "#cb6ce6",
  backgroundColor = "currentColor",
  borderWidth = 1,
  className,
  ...props
}: StarButtonProps) {
  const pathRef = useRef<HTMLButtonElement>(null);
  void backgroundColor;

  useEffect(() => {
    if (pathRef.current) {
      const div = pathRef.current;
      div.style.setProperty(
        "--path",
        `path('M 0 0 H ${div.offsetWidth} V ${div.offsetHeight} H 0 V 0')`,
      );
    }
  }, []);

  return (
    <button
      style={
        {
          "--duration": duration,
          "--light-width": `${lightWidth}px`,
          "--light-color": lightColor,
          "--border-width": `${borderWidth}px`,
          isolation: "isolate",
        } as CSSProperties
      }
      ref={pathRef}
      className={cn(
        "relative z-[3] overflow-hidden h-10 px-4 py-2 inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] text-sm font-bold transition-colors disabled:pointer-events-none disabled:opacity-50 group/star-button",
        className,
      )}
      {...props}
    >
      <div
        className="absolute aspect-square inset-0 animate-[star-btn_calc(var(--duration)*1s)_linear_infinite] bg-[radial-gradient(ellipse_at_center,var(--light-color),transparent,transparent)]"
        style={
          {
            offsetPath: "var(--path)",
            offsetDistance: "0%",
            width: "var(--light-width)",
          } as CSSProperties
        }
      />
      <div
        className="absolute inset-0 z-[4] rounded-[inherit] border-white/15"
        style={{ borderWidth: "var(--border-width)" }}
        aria-hidden
      />
      <span className="z-10 relative text-white">{children}</span>
    </button>
  );
}
