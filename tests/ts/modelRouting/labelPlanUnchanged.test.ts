import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_REPLIED_LABEL, NEEDS_HUMAN_LABEL } from "@/lib/inboxLabelPlan";
import { DEFAULT_INBOX_CATEGORIES, normalizeInboxCategory } from "@/lib/inboxSettings";
import fs from "node:fs";
import path from "node:path";

// This audit does not modify lib/inboxLabelPlan.ts or lib/inboxSettings.ts. These are golden
// assertions that lock the invariants the risk register (01-risks.md, risk #3) promises are
// unchanged, so a future edit to those files that violates them fails loudly here too.

test("default managed labels are exactly Auto Replied and Needs Human", () => {
  assert.equal(AUTO_REPLIED_LABEL, "Auto Replied");
  assert.equal(NEEDS_HUMAN_LABEL, "Needs Human");
});

test("every row in DEFAULT_INBOX_CATEGORIES is pinned mailbox:false", () => {
  for (const category of DEFAULT_INBOX_CATEGORIES) {
    assert.equal(category.auto_rules.mailbox, false, `${category.slug} must stay mailbox:false`);
  }
});

test("normalizeInboxCategory cannot be used to promote an internal-only workflow category (e.g. 'nurture') to mailbox:true", () => {
  const nurture = DEFAULT_INBOX_CATEGORIES.find((c) => c.slug === "nurture")!;
  const promoted = normalizeInboxCategory({ slug: "nurture", auto_rules: { mailbox: true } as any }, nurture);
  assert.equal(promoted.auto_rules.mailbox, false, "normalizeInboxCategory must re-derive mailbox for internal-only slugs, not trust caller input");
});

test("this audit's own new files never import or modify lib/inboxLabelPlan.ts or lib/inboxSettings.ts", () => {
  for (const file of ["../../../lib/modelRouting.ts", "../../../lib/modelPricing.ts"]) {
    const source = fs.readFileSync(path.resolve(__dirname, file), "utf8");
    assert.ok(!source.includes("inboxLabelPlan"), `${file} must not touch the label plan`);
    assert.ok(!source.includes("inboxSettings"), `${file} must not touch inbox settings`);
  }
});
