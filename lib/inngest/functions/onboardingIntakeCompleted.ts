import { inngest } from "@/lib/inngest/client";
import { recordOnboardingStep, updateOnboardingExternalIds } from "@/lib/onboardingDatabase";
import { createOnboardingSlackChannels } from "@/lib/onboardingSlack";
import type { OnboardingIntake, OnboardingKey } from "@/lib/onboarding";

export type OnboardingIntakeEvent = { clientId: string; sessionId: string; responseId: string; intake: OnboardingIntake; missingFields: OnboardingKey[] };

export const onboardingIntakeCompleted = inngest.createFunction(
  { id: "onboarding-intake-completed", name: "Provision Iris client onboarding", triggers: [{ event: "client.onboarding.intake.completed" }] },
  async ({ event, step }) => {
    const input = event.data as OnboardingIntakeEvent;
    if (input.missingFields.length) {
      await step.run("record missing intake", async () => recordOnboardingStep(input.sessionId, "intake_validation", "blocked", "", { missingFields: input.missingFields }));
      return { ok: true, blocked: "missing_intake_fields", missingFields: input.missingFields };
    }
    await step.run("complete intake validation", async () => recordOnboardingStep(input.sessionId, "intake_validation", "complete", input.responseId));
    const slackChannels = await step.run("create private Slack channels", async () => {
      await recordOnboardingStep(input.sessionId, "slack_workspace", "running");
      try {
        const channels = await createOnboardingSlackChannels(input.intake);
        await recordOnboardingStep(input.sessionId, "slack_workspace", "complete", Object.values(channels)[0] || "", { channels });
        return channels;
      } catch (error) {
        await recordOnboardingStep(input.sessionId, "slack_workspace", "failed", "", { error: String(error).slice(0, 300) });
        throw error;
      }
    });
    await step.run("create connection ledger", async () => recordOnboardingStep(input.sessionId, "secure_connections", "pending", "", { systems: input.intake.systems_to_connect, policy: "oauth_or_delegated_access" }));
    await step.run("create kickoff gate", async () => recordOnboardingStep(input.sessionId, "kickoff", "pending", "", { approver: input.intake.connection_approver }));
    await step.run("create sandbox gate", async () => recordOnboardingStep(input.sessionId, "sandbox", "pending"));
    await step.run("create launch approval gate", async () => recordOnboardingStep(input.sessionId, "launch_approval", "pending", "", { humanApprovalRequired: true }));
    await step.run("persist external ids", async () => updateOnboardingExternalIds(input.sessionId, { slack_channels: slackChannels }, "access_pending"));
    return { ok: true, state: "access_pending", slackChannels };
  },
);
