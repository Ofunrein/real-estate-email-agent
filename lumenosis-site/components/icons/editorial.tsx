import type { SVGProps } from "react";

// Lumenosis editorial icon set. Rules: 24x24 grid, 1.5px ink stroke with round
// caps (ink = currentColor, follows the surface), exactly one amber accent per
// icon via --color-brand-amber. See DESIGN.md.

type IconProps = SVGProps<SVGSVGElement>;

const AMBER = "var(--color-brand-amber)";

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** Email — a tilted letter with an amber wax seal. */
export function LetterIcon(props: IconProps) {
  return (
    <Base {...props}>
      <g transform="rotate(-4 12 12)">
        <path d="M5.9 18.1V6.3a1.7 1.7 0 0 1 1.7-1.7h6.9l3.6 3.6v9.9a1.7 1.7 0 0 1-1.7 1.7H7.6a1.7 1.7 0 0 1-1.7-1.7Z" />
        <path d="M14.5 4.6v3.6h3.6" />
        <path d="M8.8 11h4.2" />
        <circle cx="13.9" cy="15.2" r="1.8" fill={AMBER} stroke="none" />
      </g>
    </Base>
  );
}

/** Voice — an amber source point broadcasting arcs. */
export function SignalIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="6.5" cy="17.5" r="1.7" fill={AMBER} stroke="none" />
      <path d="M7.66 13.15a4.5 4.5 0 0 1 3.19 3.19" />
      <path d="M8.38 10.5a7.25 7.25 0 0 1 5.12 5.12" />
      <path d="M9.09 7.84a10 10 0 0 1 7.07 7.07" />
    </Base>
  );
}

/** SMS — typeset lines with an amber cursor mid-sentence. */
export function ReplyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 7.5h11.5M5 11.5h9M5 15.5h4.5" />
      <rect x="11.6" y="13.85" width="3.3" height="3.3" rx="0.7" fill={AMBER} stroke="none" />
    </Base>
  );
}

/** Web + social — a duotone @: ink bowl, amber sweep. */
export function AtIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M15.4 12v1.5a2.05 2.05 0 0 0 4.1 0V12a7.5 7.5 0 1 0-2.95 5.98" stroke={AMBER} />
    </Base>
  );
}

/** Speed — a stopwatch with the amber hand mid-sweep. */
export function StopwatchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="13.5" r="6.75" />
      <path d="M10.25 2.75h3.5M12 2.75v2.5" />
      <path d="M12 13.5l3.4-3.4" stroke={AMBER} />
      <circle cx="12" cy="13.5" r="1.05" fill={AMBER} stroke="none" />
    </Base>
  );
}

/** Routing — a dotted path to an amber destination. */
export function RouteIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="5.25" cy="18.6" r="1.5" fill="currentColor" stroke="none" />
      <path d="M6.9 17.1c3.1-3.5 4.6-2.6 7.3-6.7" strokeDasharray="2.6 2.9" />
      <circle cx="16.9" cy="7.4" r="2.5" stroke={AMBER} />
      <circle cx="16.9" cy="7.4" r="0.9" fill={AMBER} stroke="none" />
    </Base>
  );
}

/** Shared memory — two channels overlapping in an amber lens. */
export function LensIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path
        d="M12 7.26a5.25 5.25 0 0 1 0 9.48 5.25 5.25 0 0 1 0-9.48Z"
        fill={AMBER}
        opacity={0.4}
        stroke="none"
      />
      <circle cx="9.75" cy="12" r="5.25" />
      <circle cx="14.25" cy="12" r="5.25" />
    </Base>
  );
}

/** Property — a front door with an amber knob. */
export function DoorIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7.25 20.25V5.9a2.15 2.15 0 0 1 2.15-2.15h5.2A2.15 2.15 0 0 1 16.75 5.9v14.35" />
      <path d="M4.75 20.25h14.5" />
      <circle cx="13.9" cy="12.6" r="1.15" fill={AMBER} stroke="none" />
    </Base>
  );
}

/** Beds — an open frame with an amber pillow. */
export function BedIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3.75 18.75V9.25" />
      <path d="M3.75 15.25h16.5v3.5" />
      <path d="M20.25 15.25v-2a2.75 2.75 0 0 0-2.75-2.75H10v4.75" />
      <rect x="5.6" y="11.6" width="2.9" height="2.2" rx="1.05" fill={AMBER} stroke="none" />
    </Base>
  );
}

/** Baths — a footed tub with an amber drip. */
export function BathIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.5 12.75h15v1.5a3.75 3.75 0 0 1-3.75 3.75h-7.5A3.75 3.75 0 0 1 4.5 14.25Z" />
      <path d="M6.75 12.75V6.4a1.9 1.9 0 0 1 3.7-.65" />
      <circle cx="10.6" cy="8.9" r="0.95" fill={AMBER} stroke="none" />
      <path d="M7.4 18.4l-0.9 1.85M16.6 18.4l0.9 1.85" />
    </Base>
  );
}

/** Location — a soft teardrop with an amber core. */
export function PinIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 20.75s-6.4-6.1-6.4-10.45a6.4 6.4 0 0 1 12.8 0C18.4 14.65 12 20.75 12 20.75Z" />
      <circle cx="12" cy="10.2" r="2.1" />
      <circle cx="12" cy="10.2" r="0.85" fill={AMBER} stroke="none" />
    </Base>
  );
}

/** Dimensions — a drafting rule with one amber tick. */
export function RuleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <g transform="rotate(-45 12 12)">
        <rect x="4.4" y="10.2" width="15.2" height="3.6" rx="1.3" />
        <path d="M8 10.2v1.7M14 10.2v1.7M17 10.2v1.7" />
        <path d="M11 10.2v1.7" stroke={AMBER} />
      </g>
    </Base>
  );
}
