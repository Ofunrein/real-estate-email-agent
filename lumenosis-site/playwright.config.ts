import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm start --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DEMO_ROOM_SECRET: ["test", "demo-room-secret-at-least-32-characters"].join("-"),
      LUMENOSIS_ADMIN_PASSWORD: "7458",
      LUMENOSIS_TURSO_DATABASE_URL: "",
      LUMENOSIS_TURSO_AUTH_TOKEN: "",
    },
  },
});
