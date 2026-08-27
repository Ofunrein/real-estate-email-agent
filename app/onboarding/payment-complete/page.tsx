import Link from "next/link";

export const metadata = {
  title: "Payment Confirmed | Lumenosis",
};

export default function PaymentCompletePage() {
  return (
    <main className="mx-auto max-w-xl space-y-5 px-6 py-16 text-slate-900">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Payment confirmed</p>
      <h1 className="text-4xl font-bold">Check your email.</h1>
      <p>Resend will send your onboarding email automatically. It contains the Typeform intake and Google Calendar kickoff links.</p>
      <p className="text-sm text-slate-500">If it does not arrive within a few minutes, check spam or contact Lumenosis.</p>
      <Link className="inline-block font-semibold text-blue-700 underline" href="/onboarding/agreement">View the service agreement</Link>
    </main>
  );
}
