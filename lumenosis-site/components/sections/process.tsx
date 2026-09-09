import Image from "next/image";

const steps = [
  {
    num: "01",
    name: "Iris",
    channel: "Email",
    avatar: "/images/agents/iris.png",
    body: "Remembers every conversation across channels. Answers inbound email with real property facts, flags sensitive replies, and keeps one timeline no matter how many channels your leads use.",
  },
  {
    num: "02",
    name: "Aria",
    channel: "Voice",
    avatar: "/images/agents/aria.png",
    body: "Picks up after-hours and overflow calls, qualifies inquiry type and urgency, summarizes every conversation, and routes showings and valuations when approved.",
  },
  {
    num: "03",
    name: "Theo",
    channel: "SMS",
    avatar: "/images/agents/theo.png",
    body: "Sends the first text in under 60 seconds, shares property links and showing windows, runs long-term nurture for leads not ready to move, and honors every opt-out.",
  },
  {
    num: "04",
    name: "Olivia",
    channel: "Web + Social",
    avatar: "/images/agents/olivia.png",
    body: "Handles website chat, form fills, Instagram, Facebook Messenger, and WhatsApp. Captures intent and source, then routes urgent conversations into your CRM workflow.",
  },
];

export function Process() {
  return (
    <section id="agents" className="py-24 md:py-32">
      <div className="mx-auto w-[min(1120px,calc(100vw-48px))] sm:w-[min(1120px,calc(100vw-48px))] xl:w-[min(1120px,calc(100vw-80px))]">

        <div className="mb-16 md:mb-20">
          <h2 className="text-[clamp(1.9rem,4vw,3.1rem)] font-bold tracking-[-0.035em] leading-[1.05] text-[var(--color-ink)] max-w-[600px]">
            Four agents. One shared brain.
          </h2>
          <p className="mt-4 text-[1.0625rem] text-[var(--color-muted)] max-w-[460px] leading-relaxed">
            Each agent owns a channel. All four share the same context, so your
            leads never repeat themselves and nothing falls through.
          </p>
        </div>

        <div className="divide-y divide-[var(--color-line)]">
          {steps.map((step) => (
            <div
              key={step.num}
              className="grid grid-cols-[3rem_1fr] md:grid-cols-[3rem_220px_1fr] gap-x-5 md:gap-x-8 gap-y-1 py-7 md:py-8 items-start"
            >
              {/* Number */}
              <span className="text-[0.6875rem] font-mono font-medium text-[var(--color-muted)] tracking-[0.06em] pt-3 tabular-nums">
                {step.num}
              </span>

              {/* Avatar + name */}
              <div className="flex items-center gap-3">
                <div className="relative size-10 shrink-0 overflow-hidden rounded-full border border-[var(--color-line)]">
                  <Image
                    src={step.avatar}
                    alt={step.name}
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                </div>
                <div>
                  <p className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
                    {step.name}
                  </p>
                  <p className="text-[0.75rem] text-[var(--color-muted)] mt-0.5">{step.channel}</p>
                </div>
              </div>

              {/* Body */}
              <p className="col-start-2 md:col-start-3 text-[0.9375rem] text-[var(--color-muted)] leading-[1.7] max-w-[560px] mt-1 md:mt-0">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
