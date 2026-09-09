"use client";
import type React from "react";
import { type ReactNode, useEffect, useRef } from "react";

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  glowColor?: "purple" | "blue" | "green" | "red" | "orange" | "gold";
  customSize?: boolean;
  radius?: number;
}

const glowColorMap = {
  purple: { base: 280, spread: 300 },
  blue: { base: 220, spread: 200 },
  green: { base: 120, spread: 200 },
  red: { base: 0, spread: 200 },
  orange: { base: 30, spread: 200 },
  // Brand amber (#c49a52 ≈ hue 38). Tight spread keeps the sweep inside the
  // gold band instead of cycling the whole wheel as the pointer crosses the page.
  gold: { base: 34, spread: 16 },
};

export function GlowCard({
  children,
  className = "",
  style: userStyle,
  glowColor = "purple",
  customSize = true,
  radius,
}: GlowCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  void customSize;

  useEffect(() => {
    const sync = (e: PointerEvent) => {
      const { clientX: x, clientY: y } = e;
      if (cardRef.current) {
        cardRef.current.style.setProperty("--x", x.toFixed(2));
        cardRef.current.style.setProperty("--xp", (x / window.innerWidth).toFixed(2));
        cardRef.current.style.setProperty("--y", y.toFixed(2));
        cardRef.current.style.setProperty("--yp", (y / window.innerHeight).toFixed(2));
      }
    };
    document.addEventListener("pointermove", sync);
    return () => document.removeEventListener("pointermove", sync);
  }, []);

  const { base, spread } = glowColorMap[glowColor];

  const style = {
    "--base": base,
    "--spread": spread,
    "--default-radius": String(radius ?? 16),
    "--default-border": "4",
    "--default-backdrop": "var(--color-bg-cream)",
    "--default-backup-border": "color-mix(in srgb, var(--color-line) 70%, rgb(16 14 24))",
    "--default-size": "200",
    "--default-outer": "1",
    "--border-size": "calc(var(--border, var(--default-border)) * 1px)",
    "--spotlight-size": "calc(var(--size, var(--default-size)) * 1px)",
    "--hue": "calc(var(--base) + (var(--xp, 0) * var(--spread, 0)))",
    backgroundImage: `radial-gradient(var(--spotlight-size) var(--spotlight-size) at calc(var(--x, -9999) * 1px) calc(var(--y, -9999) * 1px), hsl(var(--hue, 280) 100% 70% / 0.10), transparent)`,
    backgroundColor: "var(--backdrop, var(--default-backdrop))",
    backgroundSize: "calc(100% + (2 * var(--border-size))) calc(100% + (2 * var(--border-size)))",
    backgroundPosition: "50% 50%",
    backgroundAttachment: "fixed",
    border: "var(--border-size) solid var(--backup-border, var(--default-backup-border))",
    position: "relative" as const,
  } as React.CSSProperties;

  const beforeAfterCSS = `[data-glow]::before,[data-glow]::after{pointer-events:none;content:"";position:absolute;inset:calc(var(--border-size)*-1);border:var(--border-size) solid transparent;border-radius:calc(var(--default-radius)*1px + var(--border-size));background-attachment:fixed;background-size:calc(100% + (2*var(--border-size))) calc(100% + (2*var(--border-size)));background-repeat:no-repeat;background-position:50% 50%;mask:linear-gradient(transparent,transparent),linear-gradient(white,white);mask-clip:padding-box,border-box;mask-composite:intersect;}[data-glow]::before{background-image:radial-gradient(calc(var(--spotlight-size)*.75) calc(var(--spotlight-size)*.75) at calc(var(--x,-9999)*1px) calc(var(--y,-9999)*1px),hsl(var(--hue,280) 100% 70% / 1),transparent 100%);filter:brightness(2);}[data-glow]::after{background-image:radial-gradient(calc(var(--spotlight-size)*.5) calc(var(--spotlight-size)*.5) at calc(var(--x,-9999)*1px) calc(var(--y,-9999)*1px),hsl(0 100% 100% / .5),transparent 100%);}@media (max-width:640px),(hover:none),(pointer:coarse){[data-glow]{background-image:none!important;}[data-glow]::before,[data-glow]::after{display:none;}}`;

  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Static local CSS for pointer-driven glow pseudo-elements. */}
      <style dangerouslySetInnerHTML={{ __html: beforeAfterCSS }} />
      <div
        ref={cardRef}
        data-glow
        style={{ ...style, borderRadius: `${radius ?? 16}px`, ...userStyle }}
        className={`group relative p-6 ${className}`}
        onPointerMove={(e) => {
          const el = cardRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          el.style.setProperty("--lx", (e.clientX - rect.left).toFixed(2));
          el.style.setProperty("--ly", (e.clientY - rect.top).toFixed(2));
        }}
      >
        <div
          data-glow
          style={
            {
              position: "absolute",
              inset: 0,
              opacity: "var(--outer,var(--default-outer))",
              borderRadius: "calc(var(--default-radius)*1px)",
              filter: `blur(calc(var(--border-size)*10))`,
              pointerEvents: "none",
              border: "none",
              background: "none",
            } as React.CSSProperties
          }
        />
        {/* Aceternity-style border glow on hover */}
        <div
          className="absolute inset-[-1px] hidden rounded-[16px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none sm:block"
          style={{
            borderRadius: "calc(var(--radius,var(--default-radius))*1px)",
            background: `radial-gradient(400px circle at calc(var(--lx, -9999) * 1px) calc(var(--ly, -9999) * 1px), hsl(var(--hue, ${base}) 78% 66% / 0.6), transparent 38%)`,
            WebkitMask: "linear-gradient(#fff,#fff) content-box, linear-gradient(#fff,#fff)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            padding: "2px",
          }}
        />
        {children}
      </div>
    </>
  );
}
