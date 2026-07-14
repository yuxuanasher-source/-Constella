import { expect, test } from "@playwright/test";

test.describe("arco redesign visual source", () => {
  test("loads the dashboard source page and records a smoke screenshot", async ({
    page,
  }, testInfo) => {
    await page.goto("/arco-redesign/index.html");
    await expect(
      page.getByRole("heading", { level: 1, name: "经营总览" }),
    ).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("dashboard-smoke.png"),
      animations: "disabled",
      fullPage: false,
    });
  });
});
