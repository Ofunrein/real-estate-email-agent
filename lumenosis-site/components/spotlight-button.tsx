"use client";
import React, { useEffect, useRef, type ReactNode } from "react";

interface SpotlightButtonWrapperProps {
  children: ReactNode;
  className?: string;
}

// Wraps any button/CTA element with a spotlight border glow effect.
// Light mode: subtle glow. Dark mode: full brightness.
export function SpotlightButtonWrapper({
  children,
  className = "",
}: SpotlightButtonWrapperProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = (e: PointerEvent) => {
      if (ref.current) {
        ref.current.style.setProperty("--bx", e.clientX.toFixed(2));
        ref.current.style.setProperty("--by", e.clientY.toFixed(2));
        ref.current.style.setProperty(
          "--bxp",
          (e.clientX / window.innerWidth).toFixed(2),
        );
      }
    };
    document.addEventListener("pointermove", sync);
    return () => document.removeEventListener("pointermove", sync);
  }, []);

  return (
    <div
      ref={ref}
      className={`relative inline-block ${className}`}
      style={
        {
          "--hue": "calc(280 + (var(--bxp, 0) * 60))",
          "--btn-size": "150px",
        } as React.CSSProperties
      }
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Static local CSS for pointer-driven button border glow. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
.btn-spotlight::before,
.btn-spotlight::after {
  pointer-events: none;
  content: "";
  position: absolute;
  inset: -1px;
  border: 1px solid transparent;
  border-radius: 9999px;
  background-attachment: fixed;
  background-size: calc(100% + 2px) calc(100% + 2px);
  background-repeat: no-repeat;
  background-position: 50% 50%;
  mask: linear-gradient(transparent, transparent), linear-gradient(white, white);
  mask-clip: padding-box, border-box;
  mask-composite: intersect;
}
.dark .btn-spotlight::before {
  background-image: radial-gradient(
    var(--btn-size) var(--btn-size) at
    calc(var(--bx, 0) * 1px)
    calc(var(--by, 0) * 1px),
    hsl(var(--hue, 280) 100% 70% / 1), transparent 100%
  );
  filter: brightness(1.5);
}
.dark .btn-spotlight::after {
  background-image: radial-gradient(
    var(--btn-size) var(--btn-size) at
    calc(var(--bx, 0) * 1px)
    calc(var(--by, 0) * 1px),
    hsl(var(--hue, 280) 100% 70% / 1), transparent 100%
  );
}
`,
        }}
      />
      <div className="btn-spotlight relative">{children}</div>
    </div>
  );
}
