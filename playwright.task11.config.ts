import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.OPS_VISUAL_PORT ?? 3107);
const baseURL = `http://127.0.0.1:${PORT}`;
const browserChannel = process.env.CI ? {} : { channel: "chrome" as const };

export default defineConfig({
  testDir: "./tests/visual",
  testMatch: /organization-brand-share\.spec\.ts$/,
  outputDir: "./.qa-screenshots/playwright-task11",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: "./.qa-screenshots/playwright-task11-html-report",
      },
    ],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "pnpm exec tsx tests/visual/organization-brand-share.spec.ts --serve-task11",
    url: baseURL,
    env: {
      ...process.env,
      TASK11_APP_PORT: String(PORT),
      TASK11_VISUAL: "1",
    },
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      testMatch: /organization-brand-share\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        ...browserChannel,
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
