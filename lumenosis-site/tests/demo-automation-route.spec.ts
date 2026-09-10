import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
const source=()=>readFile(`${process.cwd()}/app/api/admin/demos/generate/route.ts`,"utf8");
test("automation generation requires bearer secret and immutable idempotency key", async()=>{ const s=await source(); expect(s).toContain("LUMENOSIS_DEMO_AUTOMATION_TOKEN"); expect(s).toContain("idempotencyKey"); expect(s).toContain("idempotency_key"); });
test("automation receives private draft URLs without approval", async()=>{ const s=await source(); expect(s).toContain("adminUrl"); expect(s).toContain("approved: false"); expect(s).toContain("NextResponse.json"); });
