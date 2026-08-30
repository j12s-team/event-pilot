import { defineConfig, devices } from "@playwright/test";

const e2eDatabasePath = `/tmp/eventpilot-e2e-${process.pid}.db`;

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:4173", trace: "on-first-retry" },
  webServer: [
    {
      command: `NODE_ENV=test MARKET_MODE=fixture DATABASE_PATH=${e2eDatabasePath} ADMIN_TOKEN=e2e-admin-token-at-least-24-chars CORS_ORIGIN=http://localhost:4173 pnpm --filter @eventpilot/control-plane dev`,
      port: 4100,
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        "VITE_API_ORIGIN=http://127.0.0.1:4100 pnpm --filter @eventpilot/web dev --host 127.0.0.1 --port 4173",
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
