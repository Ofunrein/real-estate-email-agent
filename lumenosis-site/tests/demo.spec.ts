import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const demoSecret = ["test", "demo-room-secret-at-least-32-characters"].join("-");
const demoToken = createHmac("sha256", demoSecret)
  .update("lumenosis-demo:patricia-any-old-street")
  .digest("base64url");
const demo = `/demo/${demoToken}`;

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
]) {
  test(`demo fits ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route("**/api/demo/*/email", (route) =>
      route.fulfill({
        json: {
          subject: "Property details",
          reply: "https://example.com/" + "a".repeat(180),
          captured: [],
          nextAction: "Confirm a showing",
        },
      }),
    );
    await page.goto(demo);
    await page.getByRole("button", { name: "Run email demo" }).click();
    await expect(page.getByText("Property details", { exact: true })).toBeVisible();
    await page.getByLabel("Average commission").fill("100000");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const preview = page.locator('[aria-live="polite"]');
    expect(await preview.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    const images = page.locator("img");
    await expect
      .poll(() =>
        images.evaluateAll((nodes) => nodes.every((node) => (node as HTMLImageElement).complete)),
      )
      .toBe(true);
    expect(
      await images.evaluateAll((nodes) =>
        nodes.every((node) => {
          const rect = node.getBoundingClientRect();
          return (
            (node as HTMLImageElement).naturalWidth > 0 &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth
          );
        }),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Open photo 1 of 3" }).first().click();
    const bounds = await page.getByRole("dialog").boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThan(width);
    expect(bounds!.height).toBeLessThan(height);
  });
}

test("approved demo loads and property gallery works", async ({ page }) => {
  await page.goto(demo);
  await expect(page.getByRole("heading", { name: /every listing inquiry/i })).toBeVisible();

  await page.getByRole("button", { name: "Open photo 1 of 3" }).click();
  const gallery = page.getByRole("dialog", { name: /photo gallery/i });
  await expect(gallery).toBeVisible();
  await expect(gallery).toContainText("1 of 3");

  await page.keyboard.press("ArrowRight");
  await expect(gallery).toContainText("2 of 3");
  await page.mouse.click(4, 4);
  await expect(gallery).toBeHidden();
});

test("demo defaults to light mode and uses the landing-page theme toggle", async ({ page }) => {
  await page.goto(demo);

  await expect(page.locator("html")).toHaveClass(/light/);
  const toggle = page.getByRole("button", { name: "Switch to dark mode" });
  await expect(toggle).toBeVisible();

  await toggle.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
});

test("voice demo and opportunity result follow the active light theme", async ({ page }) => {
  await page.goto(demo);
  await expect(page.locator("html")).toHaveClass(/light/);

  const voiceCard = page.getByRole("heading", { name: "Call Iris now." }).locator("..");
  const opportunityCard = page.getByText("Estimated monthly opportunity range").locator("..");

  await expect(voiceCard).toHaveCSS("background-color", "rgb(248, 247, 243)");
  await expect(voiceCard).toHaveCSS("color", "rgb(21, 21, 21)");
  await expect(opportunityCard).toHaveCSS("background-color", "rgb(236, 233, 225)");
  await expect(opportunityCard).toHaveCSS("color", "rgb(21, 21, 21)");
});

test("final walkthrough CTA is prominent without overflowing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(demo);

  const cta = page.getByRole("link", { name: "Book a 15-minute walkthrough" });
  await expect(cta).toHaveCSS("font-size", "20px");
  await expect(cta).toHaveCSS("min-height", "72px");
  expect(await cta.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("gallery supports mobile swipe", async ({ page }) => {
  await page.goto(demo);
  await page.getByRole("button", { name: "Open photo 1 of 3" }).click();
  const gallery = page.getByRole("dialog", { name: /photo gallery/i });

  await gallery.evaluate((element) => {
    const touch = (x: number) =>
      new Touch({ identifier: 1, target: element, clientX: x, clientY: 300 });
    element.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true, changedTouches: [touch(300)] }),
    );
    element.dispatchEvent(
      new TouchEvent("touchend", { bubbles: true, changedTouches: [touch(100)] }),
    );
  });

  await expect(gallery).toContainText("2 of 3");
});

test("email preview reads like a team member", async ({ page }) => {
  await page.route("**/api/demo/*/email", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        subject: "471 Any Old Street East",
        reply:
          "Hi, I had the home listed as active at my last verification. I’ll confirm weekend showing availability. What time works best for you?\n\nBest,\nPatricia",
        captured: ["Wants a weekend showing"],
        nextAction: "Confirm availability with Patricia",
      }),
    }),
  );
  await page.goto(demo);
  await page.getByRole("button", { name: "Run email demo" }).click();
  await expect(page.getByText(/I had the home listed as active/i)).toBeVisible();
  await expect(
    page.getByText(/From: Patricia Mack · American Real Estate, ERA Powered/i),
  ).toBeVisible();
  await expect(page.getByText(/Best,\s*Patricia/i)).toBeVisible();
  await expect(page.locator('[aria-live="polite"]')).not.toContainText(
    /AI assistant|artificial intelligence|automated reply|From: Iris|route.*Patricia/i,
  );
});

test("email route keeps disclosure language out of buyer replies", async () => {
  const source = await readFile("app/api/demo/[token]/email/route.ts", "utf8");
  const policy = await readFile("lib/iris-demo-policy.ts", "utf8");
  expect(source).not.toContain("I’m Iris, the AI assistant");
  expect(source).not.toContain("AI email agent");
  expect(policy).toContain("Do not mention AI, automation, a demo");
  expect(policy).toContain("first-person voice");
  expect(policy).toContain("Never speak as Iris");
  expect(policy).toContain("End exactly with");
  expect(policy).not.toContain("Route those to");
});

test("admin actions reject unauthenticated requests", async ({ request }) => {
  const response = await request.post("/api/admin/demos/not-a-demo/approve");
  expect(response.status()).toBe(401);
});

test("admin password creates a protected session", async ({ request }) => {
  const response = await request.post("/api/admin/login", {
    form: { password: "7458" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers().location).toMatch(/\/admin\/demos$/);
  expect(response.headers()["set-cookie"]).toContain("lumenosis_admin=");
  expect(response.headers()["set-cookie"]).toContain("HttpOnly");
  expect(response.headers()["set-cookie"].toLowerCase()).toContain("samesite=strict");
});
