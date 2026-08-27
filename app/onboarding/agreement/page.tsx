export const metadata = {
  title: "Service Agreement | Lumenosis",
  description: "Lumenosis service terms for Iris email automation.",
};

const section = "space-y-2";

export default function ServiceAgreementPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12 text-slate-900">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Lumenosis</p>
        <h1 className="text-4xl font-bold">Iris Service Agreement</h1>
        <p className="text-sm text-slate-500">Effective August 27, 2026</p>
      </header>

      <section className={section}>
        <h2 className="text-xl font-semibold">1. Service and scope</h2>
        <p>Lumenosis will configure and operate the Iris email automation service described on the Stripe Checkout page or an accepted proposal. Work outside that description requires written approval and may cost extra.</p>
      </section>

      <section className={section}>
        <h2 className="text-xl font-semibold">2. Client responsibilities</h2>
        <p>You will provide accurate intake information, timely approvals, and authorized access to required systems. You remain responsible for business decisions, legal compliance, message approval rules, and the accuracy of information supplied to Iris.</p>
      </section>

      <section className={section}>
        <h2 className="text-xl font-semibold">3. Billing and refunds</h2>
        <p>Charges shown at Checkout are billed through Stripe. Subscriptions renew automatically until canceled. Payments are non-refundable once charged, except where required by law. Canceling stops future renewals but does not refund prior charges.</p>
      </section>

      <section className={section}>
        <h2 className="text-xl font-semibold">4. Milestones and acceptance</h2>
        <p>Typical milestones are intake, kickoff, connection setup, sandbox review, and launch approval. Dates depend on your access and feedback. A production launch requires your approval. Reasonable corrections within the agreed scope are included.</p>
      </section>

      <section className={section}>
        <h2 className="text-xl font-semibold">5. Intellectual property</h2>
        <p>You retain ownership of your data, brand materials, and content. Lumenosis retains ownership of its pre-existing software, templates, methods, and platform components. After payment, you may use engagement-specific deliverables for your business while your service remains active.</p>
      </section>

      <section className={section}>
        <h2 className="text-xl font-semibold">6. Data and access</h2>
        <p>Each party will use reasonable safeguards. Do not send passwords or API keys by email or intake form. Use OAuth, limited-access accounts, or another approved secure method. You authorize Lumenosis to process connected-system data only to provide and support the service.</p>
      </section>

      <section className={section}>
        <h2 className="text-xl font-semibold">7. Service limits</h2>
        <p>Automation and AI can make mistakes. Lumenosis does not guarantee specific revenue, lead volume, uptime, or outcomes. You must maintain appropriate human review for sensitive, regulated, high-value, or irreversible actions.</p>
      </section>

      <section className={section}>
        <h2 className="text-xl font-semibold">8. Termination</h2>
        <p>Either party may terminate before the next renewal by written notice or through the Stripe customer portal. Lumenosis may suspend or terminate service for nonpayment, abuse, unlawful use, security risk, or material breach. Accrued payment obligations survive termination.</p>
      </section>

      <section className={section}>
        <h2 className="text-xl font-semibold">9. Agreement</h2>
        <p>By checking the required box and completing Stripe Checkout, you confirm that you have authority to accept these terms for the purchasing business. Checkout records the accepted terms and agreement version with the payment.</p>
      </section>

      <p className="border-t pt-6 text-sm text-slate-500">Questions: contact Lumenosis before completing payment.</p>
    </main>
  );
}
