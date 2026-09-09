type Bubble = { from: "agent" | "ai"; text: string };

interface PhoneMockupProps {
  name: string;
  role: string;
  bubbles: Bubble[];
}

export function PhoneMockup({ name, role, bubbles }: PhoneMockupProps) {
  return (
    <div
      className={[
        "mx-auto flex w-full max-w-[340px] flex-col",
        "rounded-[36px]",
        "border border-white/10",
        "bg-[#0a1410]",
        "p-5",
        "shadow-[var(--shadow-glow-violet)]",
      ].join(" ")}
    >
      {/* Header bar */}
      <div className="flex items-center gap-3 border-b border-white/5 pb-3">
        {/* Avatar initial */}
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-brand-violet)]/30 font-[family-name:var(--font-display)] font-semibold text-white">
          A
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold text-white">{name}</div>
          <div className="truncate text-xs text-white/55">{role}</div>
        </div>
        {/* Live indicator */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-emerald-400">
          <span className="size-2 rounded-full bg-emerald-400" />
          On call · 02:14
        </div>
      </div>

      {/* Chat bubbles — flex-col so self-start / self-end work correctly */}
      <div className="mt-4 flex flex-col gap-2.5">
        {bubbles.map((b, i) => (
          <div
            key={i}
            className={[
              "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-snug",
              b.from === "ai"
                ? "self-end bg-[var(--color-brand-violet)]/85 text-white"
                : "self-start bg-white/[0.07] text-white/90",
            ].join(" ")}
          >
            {b.text}
          </div>
        ))}
      </div>
    </div>
  );
}
