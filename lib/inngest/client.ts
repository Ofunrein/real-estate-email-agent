import { Inngest } from "inngest";

import { inngestAppId } from "@/lib/tenant";

// App id is tenant-derived. Inngest Cloud keys apps by (environment, app id),
// so two client deployments sharing one id become one app and the later sync
// steals the earlier one's function routing. See lib/tenant.ts.
export const inngest = new Inngest({
  id: inngestAppId(),
});
