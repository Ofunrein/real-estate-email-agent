import { test } from "node:test";
import assert from "node:assert/strict";

import { polishTheoSmsCopy } from "@/lib/theoLlm";

test("polishTheoSmsCopy removes third-person showing confirmation copy", () => {
  const polished = polishTheoSmsCopy(
    "An agent from Austin Realty will reach out to confirm your 2pm showing tomorrow at 6814 Old Quarry Ln. They can answer any questions and walk you through the property. Is there anything specific you want them to know before the visit?",
  );

  assert.equal(
    polished,
    "You're set for tomorrow at 2:00 PM at 6814 Old Quarry Ln. Iris will keep this thread updated if anything changes. Reply here with any access notes or timing changes.",
  );
  assert.doesNotMatch(polished, /An agent from Austin Realty/i);
  assert.doesNotMatch(polished, /They can answer any questions/i);
});
