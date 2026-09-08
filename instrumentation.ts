import type { Instrumentation } from "next";

export function register() {
  // PostHog is initialized lazily only when a configured error is captured.
}

export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureServerException } = await import("@/lib/posthogServer");
  await captureServerException(error, {
    component: context.routeType,
    runtime: "server",
    error_code: "request_error",
  });
};
