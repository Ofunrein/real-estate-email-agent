// CRM adapter resolver. Picks the concrete adapter by CRM_PROVIDER (per client
// config). GHL is live today; FUB/kvCORE/Lofty slot in here behind the same
// CrmAdapter interface. When the active provider has no credentials, returns
// null so callers degrade gracefully instead of throwing mid-call.

import type { ClientConfig } from "@/lib/clientConfig";
import { clientConfig } from "@/lib/clientConfig";
import { createGhlAdapter } from "@/lib/crm/ghl";
import type { CrmAdapter } from "@/lib/crm/types";

export function resolveCrmAdapter(config: ClientConfig = clientConfig(), env: Record<string, string | undefined> = process.env): CrmAdapter | null {
  switch (config.crmProvider) {
    case "ghl": {
      const token = env.GHL_PRIVATE_INTEGRATION_TOKEN || env.GHL_LOCATION_PIT || "";
      const locationId = env.GHL_LOCATION_ID || "";
      if (!token || !locationId) return null;
      return createGhlAdapter({
        token,
        locationId,
        contactTag: env.GHL_CONTACT_TAG || "lumenosis-agent-os",
        messageType: env.GHL_MESSAGE_TYPE || "InternalComment",
      });
    }
    // case "fub": return createFubAdapter(...)   // future
    // case "kvcore": return createKvcoreAdapter(...)
    default:
      return null;
  }
}
