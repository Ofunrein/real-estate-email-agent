// CRM adapter resolver. Picks the concrete adapter by CRM_PROVIDER (per client
// config). GHL is live today; FUB/kvCORE slot in behind the same CrmAdapter interface.
// When the active provider has no credentials, returns null so callers degrade gracefully.

import type { ClientConfig } from "@/lib/clientConfig";
import { clientConfig } from "@/lib/clientConfig";
import { createGhlAdapter } from "@/lib/crm/ghl";
import { createKvcoreAdapter } from "@/lib/crm/kvcore";
import { createFollowUpBossAdapter } from "@/lib/crm/followupboss";
import type { CrmAdapter } from "@/lib/crm/types";
import { directCrmAdapterKey } from "@/lib/crm/providers";

export function resolveCrmAdapter(config: ClientConfig = clientConfig(), env: Record<string, string | undefined> = process.env): CrmAdapter | null {
  switch (directCrmAdapterKey(config.crmProvider) || config.crmProvider) {
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
    case "kvcore": {
      const apiKey = env.KVCORE_API_KEY || "";
      if (!apiKey) return null;
      return createKvcoreAdapter({ apiKey, baseUrl: env.KVCORE_BASE_URL });
    }
    case "fub":
    case "followupboss": {
      const apiKey = env.FUB_API_KEY || "";
      if (!apiKey) return null;
      return createFollowUpBossAdapter({ apiKey });
    }
    default:
      return null;
  }
}
