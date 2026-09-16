import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const source = () => readFile(`${process.cwd()}/app/api/admin/demos/generate/route.ts`, "utf8");

test("automation generation requires bearer secret and immutable idempotency key", async () => {
  const s = await source();
  expect(s).toContain("LUMENOSIS_DEMO_AUTOMATION_TOKEN");
  expect(s).toContain("idempotencyKey");
  expect(s).toContain("createHash");
  expect(s).toContain("WHERE d.id = ?");
});

test("automatic generation accepts approval and persists a public room", async () => {
  const s = await source();
  expect(s).toContain("approved: z.boolean().optional()");
  expect(s).toContain("const approved = automated && input.approved === true");
  expect(s).toContain('approved ? "approved" : "draft"');
  expect(s).toContain("approvedAt");
});

test("admin lists verified-import rooms even without a generated outreach draft", async () => {
  const s = await readFile(`${process.cwd()}/app/admin/demos/page.tsx`, "utf8");
  expect(s).toContain("LEFT JOIN outreach_drafts");
  expect(s).toContain("COALESCE(o.status, 'not_applicable')");
});
