import {
  claimEventDedupeInDatabase,
} from "@/lib/database";
import { inngest } from "@/lib/inngest/client";
import { syncSheetsToNeon } from "@/lib/sheetsSync";

export type SheetsChangedEvent = {
  channelId: string;
  resourceId: string;
  resourceState: string;
  messageNumber: string;
  changed?: string;
  resourceUri?: string;
  triggeredAt?: string;
};

function dedupeKey(input: SheetsChangedEvent): string {
  return [
    "google-drive-sheets",
    input.channelId,
    input.resourceId,
    input.messageNumber,
    input.resourceState,
  ].filter(Boolean).join(":");
}

export const sheetsChangedSync = inngest.createFunction(
  {
    id: "sheets-changed-sync",
    name: "Sync Google Sheets after Drive change",
    triggers: [{ event: "sheets.changed" }],
  },
  async ({ event, step }) => {
    const input = event.data as SheetsChangedEvent;
    const key = dedupeKey(input);
    if (!input.channelId || !input.resourceId || !input.messageNumber) {
      return { ok: false, error: "missing_drive_notification_headers" };
    }

    const claim = await step.run("claim sheets change dedupe", async () => {
      return claimEventDedupeInDatabase({
        dedupeKey: key,
        channel: "sheets",
        provider: "google_drive",
        providerMessageId: input.messageNumber,
        threadRef: input.resourceId,
        metadata: {
          resourceState: input.resourceState,
          changed: input.changed || "",
          resourceUri: input.resourceUri || "",
          triggeredAt: input.triggeredAt || "",
        },
      });
    });
    if (!claim.inserted) return { ok: true, skipped: "duplicate_drive_notification", dedupeKey: key };

    if (input.resourceState === "not_exists") {
      return { ok: true, skipped: "sheet_resource_not_exists", dedupeKey: key };
    }

    const result = await step.run("sync sheets to neon", async () => {
      return syncSheetsToNeon();
    });

    return { ok: true, dedupeKey: key, result };
  },
);
