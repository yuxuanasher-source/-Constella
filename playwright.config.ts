import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.OPS_VISUAL_PORT ?? 3107);
const baseURL = `http://127.0.0.1:${PORT}`;
const task11Spec = /organization-brand-share\.spec\.ts$/;
const task11ProjectRequested = process.argv.some(
  (argument, index, argumentsList) =>
    argument === "--project=chromium" ||
    (argument === "--project" && argumentsList[index + 1] === "chromium"),
);
const task11Requested =
  process.env.TASK11_VISUAL === "1" ||
  task11ProjectRequested ||
  process.argv.some((argument) =>
    argument.includes("organization-brand-share.spec"),
  );
if (task11Requested) {
  process.env.TASK11_VISUAL = "1";
}
const webServerEnv = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? baseURL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "visual-smoke-anon-key",
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "visual-smoke-service-role-key",
  ADMISSION_SHARE_CAPABILITY_SECRET:
    process.env.ADMISSION_SHARE_CAPABILITY_SECRET ??
    "visual-smoke-admission-capability-secret",
};
const localBrowserChannel = process.env.CI ? undefined : "chrome";
const browserChannel = localBrowserChannel
  ? { channel: localBrowserChannel }
  : {};

export default defineConfig({
  testDir: "./tests/visual",
  outputDir: "./.qa-screenshots/playwright",
  fullyParallel: false,
  workers: task11Requested ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: "./.qa-screenshots/playwright-html-report",
      },
    ],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: task11Requested
    ? {
        command:
          "pnpm exec tsx tests/visual/organization-brand-share.spec.ts --serve-task11",
        url: baseURL,
        env: {
          ...process.env,
          TASK11_APP_PORT: String(PORT),
        },
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : {
        command: `pnpm dev --hostname 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        env: webServerEnv,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    ...(task11Requested
      ? [
          {
            name: "chromium",
            testMatch: task11Spec,
            use: {
              ...devices["Desktop Chrome"],
              ...browserChannel,
              viewport: { width: 1440, height: 900 },
            },
          },
        ]
      : []),
    {
      name: "chromium-1920",
      testIgnore: task11Spec,
      use: {
        ...devices["Desktop Chrome"],
        ...browserChannel,
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "chromium-1440",
      testIgnore: task11Spec,
      use: {
        ...devices["Desktop Chrome"],
        ...browserChannel,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "chromium-1280",
      testIgnore: task11Spec,
      use: {
        ...devices["Desktop Chrome"],
        ...browserChannel,
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "chromium-1024",
      testIgnore: task11Spec,
      use: {
        ...devices["Desktop Chrome"],
        ...browserChannel,
        viewport: { width: 1024, height: 768 },
      },
    },
    {
      name: "chromium-tablet",
      testIgnore: task11Spec,
      use: {
        ...devices["Desktop Chrome"],
        ...browserChannel,
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "chromium-mobile",
      testIgnore: task11Spec,
      use: {
        ...devices["Pixel 5"],
        ...browserChannel,
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
