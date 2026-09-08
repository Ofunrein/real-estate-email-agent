"use client";

import React from "react";

import { captureProductException } from "@/components/analytics/ProductAnalyticsProvider";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    captureProductException(error, {
      component: "app-error-boundary",
      runtime: "client",
      error_code: "render_error",
    });
  }, [error]);

  return (
    <main className="login-shell">
      <section className="login-panel">
        <h1>Dashboard unavailable</h1>
        <p>The page could not be rendered. No customer content was included in the error report.</p>
        <button type="button" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
