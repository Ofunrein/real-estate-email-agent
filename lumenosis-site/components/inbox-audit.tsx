"use client";

import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useState } from "react";

type Answers = {
  leadVolume: string;
  responseTime: string;
  coverage: string;
  channels: string[];
  crm: string;
  name: string;
  email: string;
  phone: string;
};

const initialAnswers: Answers = {
  leadVolume: "",
  responseTime: "",
  coverage: "",
  channels: [],
  crm: "",
  name: "",
  email: "",
  phone: "",
};

const steps = [
  {
    key: "leadVolume",
    label: "How many new inbound leads does your team handle each month?",
    options: ["1–25", "26–75", "76–200", "200+"],
  },
  {
    key: "responseTime",
    label: "How quickly does a new lead usually receive a real response?",
    options: ["Under 5 minutes", "5–30 minutes", "30 minutes–2 hours", "2+ hours / next day"],
  },
  {
    key: "coverage",
    label: "What happens after hours or when the team is busy?",
    options: ["Every lead gets covered", "Someone checks when available", "Most wait until business hours", "It depends on the channel"],
  },
] as const;

function scoreAudit(answers: Answers) {
  const volume = { "1–25": 1, "26–75": 2, "76–200": 3, "200+": 4 }[answers.leadVolume] ?? 1;
  const response = {
    "Under 5 minutes": 0,
    "5–30 minutes": 1,
    "30 minutes–2 hours": 2,
    "2+ hours / next day": 3,
  }[answers.responseTime] ?? 0;
  const coverage = {
    "Every lead gets covered": 0,
    "Someone checks when available": 1,
    "Most wait until business hours": 2,
    "It depends on the channel": 2,
  }[answers.coverage] ?? 0;
  return Math.min(100, 28 + volume * 9 + response * 13 + coverage * 10 + answers.channels.length * 3);
}

function auditResult(score: number, answers: Answers) {
  const level = score >= 80 ? "High exposure" : score >= 60 ? "Meaningful exposure" : "Manageable exposure";
  const responseGap = answers.responseTime === "Under 5 minutes" ? "Fast response is in place." : `${answers.responseTime} first response creates avoidable wait time.`;
  const coverageGap = answers.coverage === "Every lead gets covered" ? "Coverage is consistent." : `${answers.coverage} leaves coverage uneven.`;
  return { level, responseGap, coverageGap };
}

export function InboxAudit() {
  const posthog = usePostHog();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(initialAnswers);
  const [variant, setVariant] = useState("response-time");
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const loaded = () => {
      const value = posthog.getFeatureFlag("inbox-audit-headline");
      if (value === "missed-leads" || value === "response-time") setVariant(value);
    };
    posthog.onFeatureFlags(loaded);
    posthog.capture("inbox_audit_started", { experiment: "inbox-audit-headline" });
  }, [posthog]);

  const score = useMemo(() => scoreAudit(answers), [answers]);
  const result = useMemo(() => auditResult(score, answers), [answers, score]);
  const progress = Math.min(100, ((step + 1) / 5) * 100);
  const headline = variant === "missed-leads" ? "Find where your next lead goes cold." : "See how fast your team can respond to every lead.";

  function choose(key: keyof Answers, value: string) {
    setAnswers((current) => ({ ...current, [key]: value }));
    posthog.capture("inbox_audit_question_completed", { question: key, answer: value });
    setStep((current) => current + 1);
  }

  function toggleChannel(channel: string) {
    setAnswers((current) => ({
      ...current,
      channels: current.channels.includes(channel)
        ? current.channels.filter((item) => item !== channel)
        : [...current.channels, channel],
    }));
  }

  async function submit() {
    if (!answers.name || !answers.email || sending) return;
    setSending(true);
    posthog.identify(answers.email, { name: answers.name, email: answers.email });
    posthog.capture("inbox_audit_email_captured", { score, lead_volume: answers.leadVolume });
    await fetch("/api/inbox-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...answers, source: "inbox_audit", auditScore: score }),
    }).catch(() => undefined);
    posthog.capture("inbox_audit_result_viewed", { score, lead_volume: answers.leadVolume });
    setSubmitted(true);
    setSending(false);
  }

  if (submitted) {
    return (
      <section className="mx-auto min-h-screen w-[min(860px,calc(100vw-40px))] py-12 sm:py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-brand-amber)]">Your inbox coverage snapshot</p>
        <div className="mt-5 grid gap-8 border-y border-[var(--color-line)] py-8 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
          <div>
            <p className="text-sm font-semibold text-[var(--color-brand-amber)]">{result.level}</p>
            <h1 className="mt-2 max-w-[13ch] text-[clamp(2.7rem,6vw,5rem)] font-semibold leading-[0.92] tracking-[-0.065em]">Your team has gaps worth closing.</h1>
          </div>
          <div className="border-l-2 border-[var(--color-brand-amber)] pl-5 sm:pb-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted)]">Exposure score</p>
            <p className="mt-1 flex items-baseline gap-1 text-5xl font-semibold leading-none tracking-[-0.06em]"><span>{score}</span><span className="text-xl tracking-[-0.03em] text-[var(--color-muted)]">/100</span></p>
          </div>
        </div>
        <p className="mt-7 max-w-[62ch] text-lg text-[var(--color-muted)]">Your score reflects response speed, coverage, lead volume, and channels. Priority: make sure every new lead gets a useful first conversation before a human has to jump in.</p>
        <div className="mt-10 grid gap-px border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-3">
          <div className="bg-[var(--color-bg)] p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-brand-amber)]">Response</p>
            <p className="mt-3 text-sm leading-6">{result.responseGap}</p>
          </div>
          <div className="bg-[var(--color-bg)] p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-brand-amber)]">Coverage</p>
            <p className="mt-3 text-sm leading-6">{result.coverageGap}</p>
          </div>
          <div className="bg-[var(--color-bg)] p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-brand-amber)]">Inbound mix</p>
            <p className="mt-3 text-sm leading-6">{answers.channels.length} channel{answers.channels.length === 1 ? "" : "s"} need a consistent handoff.</p>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <a href="#book" onClick={() => posthog.capture("inbox_audit_calendar_clicked", { score })} className="inline-flex h-12 items-center bg-[var(--color-ink)] px-6 text-sm font-semibold text-[var(--color-bg)]">Book an inbox teardown <span aria-hidden className="ml-3">→</span></a>
          <p className="text-sm text-[var(--color-muted)]">We will map the highest-impact handoff first.</p>
        </div>
        {process.env.NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL ? <div id="book" className="mt-10 overflow-hidden border border-[var(--color-line)] bg-white"><iframe title="Book an inbox teardown" src={process.env.NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL} className="h-[720px] w-full border-0" /></div> : null}
      </section>
    );
  }

  if (step === 3) {
    return (
      <section className="mx-auto min-h-screen w-[min(760px,calc(100vw-40px))] py-16 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-brand-amber)]">Step 4 of 5</p>
        <h1 className="mt-4 max-w-[18ch] text-[clamp(2.2rem,5vw,4.2rem)] font-semibold leading-[0.98] tracking-[-0.055em]">Which channels create inbound conversations?</h1>
        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {["Website", "Phone", "Text", "Email", "Instagram / social", "Portal leads"].map((channel) => <button key={channel} onClick={() => toggleChannel(channel)} className={`border p-5 text-left text-base font-medium ${answers.channels.includes(channel) ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-bg)]" : "border-[var(--color-line)] hover:border-[var(--color-ink)]"}`}>{channel}</button>)}
        </div>
        <button disabled={!answers.channels.length} onClick={() => { posthog.capture("inbox_audit_question_completed", { question: "channels", answer_count: answers.channels.length }); setStep(4); }} className="mt-8 h-12 bg-[var(--color-ink)] px-6 text-sm font-semibold text-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-40">Continue <span aria-hidden className="ml-3">→</span></button>
      </section>
    );
  }

  if (step === 4) {
    return (
      <section className="mx-auto min-h-screen w-[min(760px,calc(100vw-40px))] py-16 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-brand-amber)]">Your result is ready</p>
        <h1 className="mt-4 max-w-[16ch] text-[clamp(2.2rem,5vw,4.2rem)] font-semibold leading-[0.98] tracking-[-0.055em]">Where should we send your full inbox coverage snapshot?</h1>
        <div className="mt-10 grid gap-4 max-w-md">
          <input value={answers.name} onChange={(event) => setAnswers((current) => ({ ...current, name: event.target.value }))} placeholder="Name" className="h-12 border border-[var(--color-line)] bg-transparent px-4 outline-none focus:border-[var(--color-ink)]" />
          <input value={answers.email} onChange={(event) => setAnswers((current) => ({ ...current, email: event.target.value }))} placeholder="Work email" type="email" className="h-12 border border-[var(--color-line)] bg-transparent px-4 outline-none focus:border-[var(--color-ink)]" />
          <input value={answers.phone} onChange={(event) => setAnswers((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone (optional)" type="tel" className="h-12 border border-[var(--color-line)] bg-transparent px-4 outline-none focus:border-[var(--color-ink)]" />
          <button disabled={!answers.name || !answers.email || sending} onClick={submit} className="h-12 bg-[var(--color-ink)] px-6 text-sm font-semibold text-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-40">{sending ? "Saving…" : "Show my result"}</button>
        </div>
        <p className="mt-4 text-xs text-[var(--color-muted)]">No spam. Use this to decide whether a teardown is worth your time.</p>
      </section>
    );
  }

  const current = steps[step];
  return (
    <section className="mx-auto min-h-screen w-[min(760px,calc(100vw-40px))] py-16 sm:py-24">
      <div className="h-px w-full bg-[var(--color-line)]"><div className="h-px bg-[var(--color-brand-amber)] transition-[width] duration-300" style={{ width: `${progress}%` }} /></div>
      <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-brand-amber)]">Inbox coverage audit · step {step + 1} of 5</p>
      <h1 className="mt-4 max-w-[18ch] text-[clamp(2.2rem,5vw,4.2rem)] font-semibold leading-[0.98] tracking-[-0.055em]">{step === 0 ? headline : current.label}</h1>
      {step === 0 ? <p className="mt-6 max-w-[58ch] text-lg text-[var(--color-muted)]">Four fast questions. See where a 24/7 front desk creates more qualified conversations for your team.</p> : null}
      <div className="mt-10 grid gap-3">
        {current.options.map((option) => <button key={option} onClick={() => choose(current.key, option)} className="flex min-h-16 items-center justify-between border border-[var(--color-line)] px-5 text-left text-base font-medium hover:border-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-[var(--color-bg)]">{option}<span aria-hidden>→</span></button>)}
      </div>
    </section>
  );
}
