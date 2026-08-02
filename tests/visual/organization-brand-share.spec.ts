import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";

const APP_PORT = Number(process.env.TASK11_APP_PORT ?? 3107);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const MOCK_PORT = Number(process.env.TASK11_MOCK_PORT ?? 54329);
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const CONTACT_CARD_ID = "44444444-4444-4444-8444-444444444444";

const baseBrand = {
  schemaVersion: 1,
  version: 3,
  logoText: "星耀",
  logoStoragePath: null,
  brandName: "星耀经营舱",
  brandTagline: "专业直播项目管理",
  primaryColor: "#6B3F1D",
  actionColor: "#663400",
  softColor: "#F0E7DE",
  publishedAt: "2026-08-01T08:00:00.000Z",
  semantic: {
    success: "#00B42A",
    warning: "#FF7D00",
    danger: "#F53F3F",
    info: "#165DFF",
  },
};

const publishedBrand = {
  ...baseBrand,
  version: 4,
  logoText: "星云",
  brandName: "星云专业直播",
  brandTagline: "让每一次交付都可信",
  primaryColor: "#165DFF",
  actionColor: "#165DFF",
  softColor: "#E8F0FF",
  publishedAt: "2026-08-02T08:00:00.000Z",
};

const contactCard = {
  id: CONTACT_CARD_ID,
  displayName: "林商务",
  title: "品牌合作负责人",
  phone: "13800000000",
  email: "lin@example.test",
  wechat: "xingyun-lin",
  status: "active",
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
};

const disabledContactCard = {
  ...contactCard,
  id: "55555555-5555-4555-8555-555555555555",
  displayName: "旧联系人",
  status: "disabled",
};

type ServerMode = {
  opsV2: boolean;
  brandUi: boolean;
};

type MockState = {
  brand: typeof baseBrand;
  mode: ServerMode;
};

if (process.argv.includes("--serve-task11")) {
  void serveTask11();
} else {
  defineBrowserTests();
}

async function serveTask11() {
  const state: MockState = {
    brand: structuredClone(baseBrand),
    mode: { opsV2: false, brandUi: true },
  };
  let nextProcess: ChildProcess | null = null;
  let restarting = Promise.resolve();

  const restartNext = (mode: ServerMode) => {
    restarting = restarting.then(async () => {
      if (nextProcess) {
        await stopChild(nextProcess);
        nextProcess = null;
        await waitForAppToStop();
      }
      state.mode = mode;
      const nextBin = resolve(process.cwd(), "node_modules/next/dist/bin/next");
      nextProcess = spawn(
        process.execPath,
        [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(APP_PORT)],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NEXT_PUBLIC_APP_URL: APP_URL,
            NEXT_PUBLIC_SUPABASE_URL: MOCK_URL,
            SUPABASE_INTERNAL_URL: MOCK_URL,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: "task11-visual-anon-key",
            SUPABASE_SERVICE_ROLE_KEY: "task11-visual-service-role-key",
            ADMISSION_SHARE_CAPABILITY_SECRET:
              "task11-visual-admission-capability-secret",
            ADMISSION_SHARE_BRAND_UI: String(mode.brandUi),
            NEXT_PUBLIC_OPS_UI_V2: String(mode.opsV2),
            NEXT_TELEMETRY_DISABLED: "1",
          },
          stdio: "inherit",
        },
      );
      await waitForApp();
      await warmConsole(mode);
    });
    return restarting;
  };

  const mockServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", MOCK_URL);
      if (url.pathname === "/health") {
        return json(response, 200, { ok: true });
      }
      if (url.pathname === "/__task11/reset" && request.method === "POST") {
        state.brand = structuredClone(baseBrand);
        return json(response, 200, { ok: true });
      }
      if (url.pathname === "/__task11/brand" && request.method === "POST") {
        const body = await readJson(request);
        state.brand = {
          ...state.brand,
          ...(isRecord(body) && isRecord(body.brand) ? body.brand : {}),
        } as typeof baseBrand;
        return json(response, 200, { ok: true });
      }
      if (url.pathname === "/__task11/mode" && request.method === "POST") {
        const body = await readJson(request);
        const mode = {
          opsV2: Boolean(isRecord(body) && body.opsV2),
          brandUi:
            !isRecord(body) || body.brandUi === undefined
              ? true
              : Boolean(body.brandUi),
        };
        if (
          mode.opsV2 !== state.mode.opsV2 ||
          mode.brandUi !== state.mode.brandUi
        ) {
          await restartNext(mode);
        }
        return json(response, 200, mode);
      }
      if (url.pathname === "/auth/v1/user") {
        const role = roleFromRequest(request);
        const userId = role === "owner" ? OWNER_ID : MEMBER_ID;
        return json(response, 200, {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: `${role}@task11.example.test`,
          email_confirmed_at: "2026-08-01T00:00:00.000Z",
          phone: "",
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          identities: [],
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        });
      }
      if (url.pathname.startsWith("/rest/v1/profiles")) {
        const role = roleFromRequest(request);
        return postgrest(response, request, {
          full_name: role === "owner" ? "Owner Visual" : "Member Visual",
          requires_onboarding: false,
          avatar_text: role === "owner" ? "OV" : "MV",
          avatar_url: null,
        });
      }
      if (url.pathname.startsWith("/rest/v1/organization_members")) {
        const role = roleFromRequest(request);
        return json(response, 200, [
          {
            organization_id: ORGANIZATION_ID,
            role,
            created_at: "2026-08-01T00:00:00.000Z",
            organizations: {
              name: "星耀 MCN",
              branding: state.brand,
            },
          },
        ]);
      }
      if (url.pathname.startsWith("/rest/v1/organizations")) {
        return postgrest(response, request, {
          id: ORGANIZATION_ID,
          name: "星耀 MCN",
          branding: state.brand,
          branding_version: state.brand.version,
        });
      }
      if (url.pathname.startsWith("/rest/v1/organization_brand_drafts")) {
        const role = roleFromRequest(request);
        return postgrest(
          response,
          request,
          role === "owner"
            ? {
                organization_id: ORGANIZATION_ID,
                base_version: state.brand.version,
                content: {
                  logoText: state.brand.logoText,
                  logoStoragePath: null,
                  brandName: `${state.brand.brandName}草稿`,
                  brandTagline: state.brand.brandTagline,
                  primaryColor: state.brand.primaryColor,
                },
                updated_by: OWNER_ID,
                updated_at: "2026-08-02T07:00:00.000Z",
              }
            : null,
        );
      }
      if (url.pathname.startsWith("/rest/v1/organization_brand_versions")) {
        return json(response, 200, [
          {
            organization_id: ORGANIZATION_ID,
            version: state.brand.version,
            content: state.brand,
            published_by: OWNER_ID,
            published_at: state.brand.publishedAt ?? "2026-08-01T08:00:00.000Z",
          },
        ]);
      }
      if (url.pathname.startsWith("/rest/v1/organization_contact_cards")) {
        const role = roleFromRequest(request);
        const cards =
          role === "owner"
            ? [contactCardRow(), disabledCardRow()]
            : [contactCardRow()];
        return json(response, 200, cards);
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        return json(response, 200, [], { "Content-Range": "0-0/0" });
      }
      return json(response, 404, { message: "fixture endpoint not found" });
    } catch (error) {
      return json(response, 500, {
        message: error instanceof Error ? error.message : "fixture failure",
      });
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(MOCK_PORT, "127.0.0.1", resolveListen);
  });
  await restartNext(state.mode);

  const close = async () => {
    if (nextProcess) await stopChild(nextProcess);
    mockServer.close();
  };
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
}

function defineBrowserTests() {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(({}, testInfo) => {
    testInfo.setTimeout(120_000);
  });

  test.beforeAll(async ({ request }) => {
    await expect(
      (await request.post(`${MOCK_URL}/__task11/reset`)).ok(),
    ).toBeTruthy();
    await setServerMode(request, { opsV2: false, brandUi: true });
  });

  test("owner publishes once and both console shells refresh while members stay read-only", async ({
    page,
    request,
  }) => {
    await setStaffSession(page.context(), "owner");
    let savePayload: Record<string, unknown> | null = null;
    let publishPayload: Record<string, unknown> | null = null;

    await page.route("**/api/organization/brand{,/publish}", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/publish")) {
        publishPayload = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
        await fetch(`${MOCK_URL}/__task11/brand`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brand: publishedBrand }),
        });
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ version: 4, published: publishedBrand }),
        });
      }
      if (route.request().method() === "PATCH") {
        savePayload = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            draft: {
              baseVersion: 3,
              persisted: true,
              updatedAt: "2026-08-02T07:30:00.000Z",
              content: {
                logoText: "星云",
                logoStoragePath: null,
                brandName: publishedBrand.brandName,
                brandTagline: publishedBrand.brandTagline,
                primaryColor: publishedBrand.primaryColor,
              },
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        json: { studio: ownerStudio(baseBrand) },
      });
    });

    await page.goto("/console/brand");
    await expect(page.getByRole("heading", { name: "品牌中心" })).toBeVisible();
    await page.getByLabel("LOGO 字标").fill("星云");
    await page.getByLabel("品牌名称").fill(publishedBrand.brandName);
    await page.getByLabel("品牌副标").fill(publishedBrand.brandTagline);
    await page
      .getByRole("textbox", { name: "品牌主色", exact: true })
      .fill("#165DFF");
    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page.getByRole("status")).toContainText("草稿已保存");
    await page.getByRole("button", { name: "准备发布" }).click();
    await page.getByRole("button", { name: "确认发布草稿" }).click();
    await expect(page.getByRole("status")).toContainText("品牌已发布为 v4");

    expect(savePayload).toEqual({
      expectedVersion: 3,
      logoText: "星云",
      logoStoragePath: null,
      brandName: publishedBrand.brandName,
      brandTagline: publishedBrand.brandTagline,
      primaryColor: publishedBrand.primaryColor,
    });
    expect(publishPayload).toEqual({ expectedVersion: 3 });

    await page.goto("/console");
    await expect(page.locator(".ops-reference-shell")).toBeVisible();
    await expect(
      page.getByText(publishedBrand.brandName).first(),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("logoStoragePath");

    await setServerMode(request, { opsV2: true, brandUi: true });
    await page.goto("/console");
    await expect(page.locator(".ops-v2-shell")).toBeVisible();
    await expect(
      page.getByText(publishedBrand.brandName).first(),
    ).toBeVisible();

    await setServerMode(request, { opsV2: false, brandUi: true });
    await setStaffSession(page.context(), "finance");
    await page.goto("/console/brand");
    await expect(page.getByText("当前已发布品牌")).toBeVisible();
    await expect(page.getByText(contactCard.displayName)).toBeVisible();
    await expect(page.getByText(disabledContactCard.displayName)).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "保存草稿" })).toHaveCount(0);
    await expect(page.getByText("联系名片管理")).toHaveCount(0);
  });

  test("internal share creation sends only contactCardId and reuses persisted snapshots", async ({
    page,
  }, testInfo) => {
    await setStaffSession(page.context(), "owner");
    const capturedCreates: Record<string, unknown>[] = [];
    await installConsoleShareRoutes(page, capturedCreates);
    await openShareCenter(page);

    const createButton = page.getByRole("button", { name: "创建分享" });
    await page.getByRole("checkbox", { name: /选择 Streamer One/ }).check();
    await createButton.focus();
    await createButton.press("Enter");
    const wizard = page.getByRole("dialog", { name: "创建录屏分享" });
    await expect(wizard).toBeVisible();
    await expect(wizard.getByLabel("对外联系名片")).toHaveValue("");
    await wizard.getByRole("button", { name: "关闭创建向导" }).press("Escape");
    await expect(wizard).toHaveCount(0);
    const focusAfterWizardEscape = await page.evaluate(() => ({
      tagName: document.activeElement?.tagName ?? null,
      ariaLabel: document.activeElement?.getAttribute("aria-label") ?? null,
      text: document.activeElement?.textContent?.trim().slice(0, 80) ?? null,
    }));
    await testInfo.attach("wizard-focus-return-candidate", {
      body: JSON.stringify(focusAfterWizardEscape, null, 2),
      contentType: "application/json",
    });
    await writeFile(
      testInfo.outputPath("wizard-focus-return-candidate.json"),
      `${JSON.stringify(focusAfterWizardEscape, null, 2)}\n`,
      "utf8",
    );
    await page.screenshot({
      path: testInfo.outputPath("wizard-focus-return-candidate.png"),
    });

    await createButton.focus();
    await createButton.press("Enter");
    await wizard.getByRole("button", { name: "下一步" }).click();
    await expect(
      wizard.getByRole("region", { name: "将要创建的外部分享预览" }),
    ).toContainText("联系方式：不展示");
    await wizard.getByRole("button", { name: "确认生成" }).click();
    const delivery = page.getByRole("dialog", { name: "一次性交付信息" });
    await expect(delivery).toContainText("服务端已保存：无名片");
    await expect(delivery).toContainText(publishedBrand.brandName);
    await delivery.getByRole("button", { name: "关闭交付信息" }).click();

    await page.getByRole("tab", { name: "录屏库" }).click();
    await page.getByRole("checkbox", { name: /选择 Streamer One/ }).check();
    await page.getByRole("button", { name: "创建分享" }).click();
    await wizard.getByLabel("对外联系名片").selectOption(CONTACT_CARD_ID);
    await wizard.getByRole("button", { name: "下一步" }).click();
    await expect(
      wizard.getByRole("region", { name: "将要创建的外部分享预览" }),
    ).toContainText(contactCard.displayName);
    await wizard.getByRole("button", { name: "确认生成" }).click();
    await expect(delivery).toContainText("服务端已保存：带名片");
    await expect(delivery).toContainText(contactCard.displayName);
    await delivery.getByRole("button", { name: "关闭交付信息" }).click();

    expect(capturedCreates).toHaveLength(2);
    expect(capturedCreates[0]?.contactCardId).toBeNull();
    expect(capturedCreates[1]?.contactCardId).toBe(CONTACT_CARD_ID);
    for (const payload of capturedCreates) {
      expect(payload).not.toHaveProperty("brand");
      expect(payload).not.toHaveProperty("brandSnapshot");
      expect(payload).not.toHaveProperty("contactCard");
      expect(payload).not.toHaveProperty("contactCardSnapshot");
      expect(JSON.stringify(payload)).not.toContain("storagePath");
    }

    await page.getByRole("tab", { name: "分享任务" }).click();
    await page
      .getByRole("button", { name: /查看 旧品牌复核 分享预览/ })
      .click();
    const oldPreview = page.getByRole("region", {
      name: "旧品牌复核 已保存分享预览",
    });
    await expect(oldPreview).toContainText(baseBrand.brandName);
    await expect(oldPreview).not.toContainText(publishedBrand.brandName);
    await expect(oldPreview).toContainText(disabledContactCard.displayName);
    await expect(page.locator("body")).not.toContainText(
      "organizations/private",
    );
  });

  test("public header uses the persisted brand snapshot, contact choice, and safe logo fallback", async ({
    page,
  }) => {
    const withContact = publicBoard({
      brand: publicBrand(baseBrand),
      contactCard,
      items: [mediaItems()[0]],
    });
    const withoutContact = publicBoard({
      brand: publicBrand(publishedBrand),
      contactCard: null,
      title: "No contact share",
      items: [mediaItems()[0]],
    });
    await installPublicRoutes(page, {
      oldSnapshot: { board: withContact, failLogo: true },
      noContact: { board: withoutContact },
    });

    await page.goto("/share/admission/oldSnapshot");
    await expect(page.getByText("组织官方分享").first()).toBeVisible();
    await expect(page.getByText(baseBrand.brandName).first()).toBeVisible();
    await expect(page.getByText(publishedBrand.brandName)).toHaveCount(0);
    await expect(page.getByLabel("商务对接")).toContainText(
      contactCard.displayName,
    );
    await expect(
      page.getByRole("img", { name: `${baseBrand.brandName} LOGO` }),
    ).toHaveCount(0);
    await expect(page.getByLabel(`${baseBrand.brandName} 字标`)).toContainText(
      baseBrand.logoText,
    );
    await expect(page.locator("body")).not.toContainText("storagePath");

    await page.goto("/share/admission/noContact");
    await expect(page.getByText("No contact share")).toBeVisible();
    await expect(page.getByLabel("商务对接")).toHaveCount(0);
  });

  test("access-code, expired, and revoked gates remain authoritative", async ({
    page,
  }) => {
    const board = publicBoard({ items: [mediaItems()[0]] });
    await installPublicRoutes(page, {
      protectedShare: { board, accessRequired: true },
      expiredShare: {
        error: { status: 410, code: "SHARE_EXPIRED", error: "分享已过期。" },
      },
      revokedShare: {
        error: { status: 410, code: "SHARE_REVOKED", error: "分享已撤销。" },
      },
    });

    await page.goto("/share/admission/protectedShare");
    const accessCode = page.getByRole("textbox", {
      name: "访问码",
      exact: true,
    });
    await expect(accessCode).toBeFocused();
    await accessCode.fill("visual-access-code");
    await page.getByRole("button", { name: "验证访问码" }).click();
    await expect(
      page.getByRole("region", { name: "录屏复核工作台" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/protectedShare$/);

    await page.goto("/share/admission/expiredShare");
    await expect(
      page.getByRole("alert").filter({ hasText: "分享已过期" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "录屏复核工作台" }),
    ).toHaveCount(0);

    await page.goto("/share/admission/revokedShare");
    await expect(
      page.getByRole("alert").filter({ hasText: "分享已撤销" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "录屏复核工作台" }),
    ).toHaveCount(0);
  });

  test("media source matrix stays light, preserves review state, and records stable screenshots", async ({
    page,
  }, testInfo) => {
    const items = mediaItems();
    const board = publicBoard({ items, allowExternalFallback: true });
    await installPublicRoutes(page, { mediaMatrix: { board } });
    await page.goto("/share/admission/mediaMatrix");
    await expect(
      page.getByRole("region", { name: "录屏复核工作台" }),
    ).toBeVisible();

    const remark = page.getByLabel("当前录屏备注");
    await remark.fill("Keep this draft while checking media sources");

    await openMediaItem(page, "Original Landscape");
    await startVideo(page, "Original Landscape", "Enter", 1920, 1080);
    await assertLightStageAndScreenshot(
      page,
      testInfo.outputPath("media-original-landscape.png"),
    );

    await openMediaItem(page, "Original Portrait");
    await startVideo(page, "Original Portrait", "Space", 1080, 1920);
    await expect(page.locator(".recording-media-canvas")).toHaveAttribute(
      "data-orientation",
      "portrait",
    );
    await assertLightStageAndScreenshot(
      page,
      testInfo.outputPath("media-original-portrait.png"),
    );

    await openMediaItem(page, "External Embed");
    await page.getByRole("button", { name: "播放录屏" }).press("Enter");
    const embed = page.locator(
      'iframe[aria-label="External Embed 外部录屏播放器"]',
    );
    await expect(embed).toBeVisible();
    await embed.dispatchEvent("load");
    await assertLightStageAndScreenshot(
      page,
      testInfo.outputPath("media-external-embed.png"),
    );

    await openMediaItem(page, "External Link");
    await expect(page.getByRole("alert", { name: "录屏不可用" })).toContainText(
      "外部平台",
    );
    await expect(
      page.getByRole("link", { name: "打开外部录屏" }),
    ).toBeVisible();
    await assertLightStageAndScreenshot(
      page,
      testInfo.outputPath("media-external-link.png"),
    );

    await openMediaItem(page, "Original Failure");
    await page.getByRole("button", { name: "播放录屏" }).click();
    await page
      .locator('video[aria-label="Original Failure 原始录屏播放器"]')
      .evaluate((video) => {
        video.dataset.task11AllowError = "true";
        video.dispatchEvent(new Event("error"));
      });
    await expect(
      page.getByRole("alert", { name: "录屏播放失败" }),
    ).toContainText("视频加载失败");
    await expect(
      page.getByRole("status", { name: "录屏加载状态" }),
    ).toHaveCount(0);
    await assertLightStageAndScreenshot(
      page,
      testInfo.outputPath("media-original-failure.png"),
    );

    await openMediaItem(page, "No Source");
    await expect(page.getByRole("alert", { name: "录屏不可用" })).toContainText(
      "当前没有可播放来源",
    );
    await assertLightStageAndScreenshot(
      page,
      testInfo.outputPath("media-no-source.png"),
    );

    await openMediaItem(page, "External Fallback");
    await page.getByRole("button", { name: "播放录屏" }).click();
    await page
      .locator('video[aria-label="External Fallback 原始录屏播放器"]')
      .evaluate((video) => {
        video.dataset.task11AllowError = "true";
        video.dispatchEvent(new Event("error"));
      });
    await expect(
      page.getByRole("link", { name: "打开备用视频" }),
    ).toBeVisible();
    await assertLightStageAndScreenshot(
      page,
      testInfo.outputPath("media-external-fallback.png"),
    );

    await openMediaItem(page, "Original Landscape");
    await expect(remark).toHaveValue(
      "Keep this draft while checking media sources",
    );
    for (const item of items) {
      await expect(
        page
          .getByRole("button", { name: new RegExp(item.streamer.displayName) })
          .first(),
      ).toBeVisible();
    }
    await expect(page.locator("body")).not.toContainText(
      "organizations/private",
    );
    await expect(page.locator("body")).not.toContainText("storagePath");
  });

  test("three viewports, keyboard focus, reduced motion, and forced colors remain usable", async ({
    page,
  }, testInfo) => {
    const board = publicBoard({ items: mediaItems().slice(0, 2) });
    await installPublicRoutes(page, { responsive: { board } });

    for (const viewport of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "medium", width: 1024, height: 768 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/share/admission/responsive");
      const workspace = page.getByRole("region", { name: "录屏复核工作台" });
      await expect(workspace).toBeVisible();
      const box = await workspace.boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: testInfo.outputPath(`viewport-${viewport.name}.png`),
        animations: "disabled",
        fullPage: false,
      });
    }

    const drawerButton = page.getByRole("button", { name: "打开录屏列表" });
    await drawerButton.focus();
    await drawerButton.press("Enter");
    const drawer = page.getByRole("dialog", { name: "选择录屏" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "关闭录屏列表" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(drawer.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(drawerButton).toBeFocused();
    await expect(page.getByRole("button", { name: "上一条" })).toBeVisible();
    await expect(page.getByRole("button", { name: "下一条" })).toBeVisible();

    const play = page.getByRole("button", { name: "播放录屏" });
    await play.focus();
    const focusIndicator = await play.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    expect(
      focusIndicator.boxShadow !== "none" ||
        (focusIndicator.outlineStyle !== "none" &&
          focusIndicator.outlineWidth !== "0px"),
    ).toBeTruthy();
    await play.press("Space");
    await expect(
      page.getByRole("status", { name: "录屏加载状态" }),
    ).toContainText("正在加载");
    await page
      .locator('video[aria-label="Original Landscape 原始录屏播放器"]')
      .evaluate((video) => {
        video.dataset.task11AllowError = "true";
        video.dispatchEvent(new Event("error"));
      });
    await expect(
      page.getByRole("alert", { name: "录屏播放失败" }),
    ).toBeVisible();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.getByRole("button", { name: "播放录屏" }).click();
    const spinner = page
      .getByRole("button", { name: /正在加载录屏/ })
      .locator("svg");
    await expect(spinner).toBeVisible();
    expect(
      await spinner.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("none");

    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await page.reload();
    await expect(
      page.getByRole("region", { name: "录屏复核工作台" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "播放录屏" }).focus();
    await expect(page.getByRole("button", { name: "播放录屏" })).toBeFocused();
  });

  test("ADMISSION_SHARE_BRAND_UI=false keeps the established public shell", async ({
    page,
    request,
  }) => {
    await setServerMode(request, { opsV2: false, brandUi: false });
    await installPublicRoutes(page, {
      flagOff: { board: publicBoard({ items: [mediaItems()[0]] }) },
    });
    await page.goto("/share/admission/flagOff");
    await expect(page.getByText("受控录屏复核")).toBeVisible();
    await expect(page.getByText("组织官方分享")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "播放录屏" })).toHaveCount(0);
    await expect(
      page.locator('video[aria-label="Original Landscape 原始录屏播放器"]'),
    ).toBeVisible();
    await setServerMode(request, { opsV2: false, brandUi: true });
  });
}

async function installConsoleShareRoutes(
  page: Page,
  capturedCreates: Record<string, unknown>[],
) {
  const candidate = {
    applicationId: "application-1",
    recordingSubmissionId: "recording-1",
    recordingVersion: 2,
    isLatestVersion: true,
    streamer: {
      id: "streamer-1",
      displayName: "Streamer One",
      accountLabel: "streamer_one",
    },
    mcnReviewDecision: "approved",
    sourceHealth: "original_ready",
    hasPrivateStorage: true,
    externalUrl: null,
    isShareable: true,
    blockReason: null,
    currentVendorDecision: "pending",
    lastSharedAt: null,
  };
  const oldTask = {
    id: "share-old",
    title: "旧品牌复核",
    purpose: "Snapshot proof",
    mode: "formal_review",
    status: "active",
    reviewState: "not_started",
    roundNumber: 1,
    expiresAt: "2099-08-01T00:00:00.000Z",
    itemCount: 1,
    draftCompletedCount: 0,
    lastViewedAt: null,
    lastDraftAt: null,
    lastSubmittedAt: null,
    lockedAt: null,
    createdBy: OWNER_ID,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  let createdCount = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/api/applications/admission-board") {
      return fulfillJson(route, {
        projects: [admissionProjectBoard()],
      });
    }
    if (pathname === "/api/applications")
      return fulfillJson(route, { applications: [] });
    if (pathname === "/api/admission-review/metrics")
      return fulfillJson(route, { metrics: [] });
    if (pathname === "/api/organization/brand") {
      return fulfillJson(route, { studio: ownerStudio(publishedBrand) });
    }
    if (pathname === "/api/organization/contact-cards") {
      return fulfillJson(route, {
        contactCards: [contactCard, disabledContactCard],
      });
    }
    if (pathname.endsWith("/admission-share-candidates")) {
      return fulfillJson(route, { candidates: [candidate] });
    }
    if (pathname.endsWith("/admission-share-boards/preflight")) {
      const body = request.postDataJSON() as {
        items: Record<string, unknown>[];
      };
      return fulfillJson(route, {
        summary: { ready: body.items.length, warning: 0, blocked: 0 },
        items: body.items.map((item) => ({
          ...item,
          status: "ready",
          sourceHealth: "original_ready",
          reasonCode: null,
        })),
      });
    }
    if (pathname.endsWith("/admission-share-boards")) {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as Record<string, unknown>;
        capturedCreates.push(body);
        createdCount += 1;
        const selectedContact =
          body.contactCardId === CONTACT_CARD_ID ? contactCard : null;
        return fulfillJson(route, {
          shareBoard: {
            id: `share-created-${createdCount}`,
            mode: body.mode,
            presentation: persistedPresentation({
              id: `share-created-${createdCount}`,
              title: `服务端已保存：${selectedContact ? "带名片" : "无名片"}`,
              brand: publicBrand(publishedBrand),
              contactCard: selectedContact,
            }),
          },
          shareUrl: `${APP_URL}/share/admission/created-${createdCount}`,
          accessCode: "",
        });
      }
      if (url.searchParams.has("boardId")) {
        return fulfillJson(route, {
          shareBoard: {
            id: oldTask.id,
            presentation: persistedPresentation({
              id: oldTask.id,
              title: oldTask.title,
              brand: publicBrand(baseBrand),
              contactCard: disabledContactCard,
            }),
          },
        });
      }
      return fulfillJson(route, { shareBoards: [oldTask], nextCursor: null });
    }
    if (pathname.endsWith("/admission-share-playback-issues")) {
      return fulfillJson(route, { issues: [] });
    }
    return fulfillJson(route, {});
  });
}

async function openShareCenter(page: Page) {
  await page.goto("/console");
  await expect(page.locator(".ops-reference-shell")).toBeVisible();
  await page.getByRole("button", { name: "选播准入" }).click();
  await expect(page.getByRole("heading", { name: "选播准入" })).toBeVisible();
  await expect(page.getByText("Task11 Project").first()).toBeVisible();
  await page.getByRole("button", { name: "录屏分享中心" }).click();
  await expect(
    page.getByRole("dialog", { name: "Task11 Project 录屏分享中心" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /选择 Streamer One/ }),
  ).toBeVisible();
}

type PublicRouteFixture = {
  board?: ReturnType<typeof publicBoard>;
  accessRequired?: boolean;
  failLogo?: boolean;
  error?: { status: number; code: string; error: string };
};

async function installPublicRoutes(
  page: Page,
  fixtures: Record<string, PublicRouteFixture>,
) {
  await page.addInitScript(() => {
    document.addEventListener(
      "error",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLVideoElement)) return;
        if (target.dataset.task11AllowError === "true") return;
        event.stopImmediatePropagation();
      },
      true,
    );
  });
  const authenticated = new Set<string>();
  await page.route("**/api/public/admission-share/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/").filter(Boolean);
    const token = decodeURIComponent(parts[3] ?? "");
    const fixture = fixtures[token];
    if (!fixture)
      return fulfillJson(route, { code: "NOT_FOUND", error: "Not found" }, 404);
    const suffix = parts.slice(4);

    if (suffix[0] === "brand-logo") {
      if (fixture.failLogo) return route.abort("failed");
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#165DFF"/></svg>',
      });
    }
    if (suffix[0] === "recordings" && suffix[2] === "issues") {
      return fulfillJson(route, { issueId: "issue-1" });
    }
    if (suffix[0] === "recordings") {
      return route.fulfill({
        status: 200,
        contentType: "video/mp4",
        body: Buffer.from("task11-controlled-media"),
      });
    }
    if (suffix[0] === "access") {
      authenticated.add(token);
      return fulfillJson(route, { authenticated: true });
    }
    if (suffix[0] === "drafts" && suffix.length === 1) {
      return fulfillJson(route, { drafts: [] });
    }
    if (suffix[0] === "drafts" && request.method() === "PUT") {
      const body = request.postDataJSON() as Record<string, unknown>;
      return fulfillJson(route, {
        decision: body.decision,
        remark: body.remark,
        reasonCodes: body.reasonCodes,
        revision: Number(body.expectedRevision ?? 0) + 1,
        updatedAt: "2026-08-02T09:00:00.000Z",
      });
    }
    if (fixture.error)
      return fulfillJson(route, fixture.error, fixture.error.status);
    if (fixture.accessRequired && !authenticated.has(token)) {
      return fulfillJson(
        route,
        { code: "ACCESS_CODE_REQUIRED", error: "请输入访问码后继续。" },
        401,
      );
    }
    return fulfillJson(route, {
      shareBoard: fixture.board,
      vendorCheckpoints: [],
    });
  });

  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Controlled embed</title><p>embed fixture</p>",
    }),
  );
}

function publicBoard(overrides: Record<string, unknown> = {}) {
  return {
    id: "share-public",
    title: "Task11 Recording Review",
    purpose: "Verify professional delivery",
    mode: "formal_review",
    status: "active",
    reviewState: "in_progress",
    roundNumber: 2,
    expiresAt: "2099-08-06T00:00:00.000Z",
    canSubmit: true,
    allowExternalFallback: true,
    brand: publicBrand(publishedBrand),
    contactCard: null,
    progress: { completed: 0, total: 1 },
    latestSubmission: null,
    project: {
      id: "project-1",
      code: "TASK11-01",
      name: "Task11 Project",
      vendor: "Brand Partner",
      product: "Product A",
    },
    items: [mediaItems()[0]],
    ...overrides,
  };
}

function mediaItems() {
  const item = (
    id: string,
    displayName: string,
    input: {
      playbackUrl: string | null;
      externalUrl: string | null;
      sourceHealth: string;
      hasPrivateStorage: boolean;
    },
  ) => ({
    applicationId: `application-${id}`,
    recordingSubmissionId: id,
    recordingVersion: 1,
    ...input,
    streamer: {
      id: `streamer-${id}`,
      displayName,
      accountLabel: `account_${id}`,
    },
    finalReview: null,
  });
  return [
    item("original-landscape", "Original Landscape", {
      playbackUrl:
        "/api/public/admission-share/mediaMatrix/recordings/original-landscape",
      externalUrl: null,
      sourceHealth: "original_ready",
      hasPrivateStorage: true,
    }),
    item("original-portrait", "Original Portrait", {
      playbackUrl:
        "/api/public/admission-share/mediaMatrix/recordings/original-portrait",
      externalUrl: null,
      sourceHealth: "original_ready",
      hasPrivateStorage: true,
    }),
    item("external-embed", "External Embed", {
      playbackUrl: "https://www.youtube.com/watch?v=task11",
      externalUrl: "https://www.youtube.com/watch?v=task11",
      sourceHealth: "external_only",
      hasPrivateStorage: false,
    }),
    item("external-link", "External Link", {
      playbackUrl: "https://video.example.test/watch/task11",
      externalUrl: "https://video.example.test/watch/task11",
      sourceHealth: "external_only",
      hasPrivateStorage: false,
    }),
    item("original-failure", "Original Failure", {
      playbackUrl:
        "/api/public/admission-share/mediaMatrix/recordings/original-failure",
      externalUrl: null,
      sourceHealth: "original_ready",
      hasPrivateStorage: true,
    }),
    item("no-source", "No Source", {
      playbackUrl: null,
      externalUrl: null,
      sourceHealth: "blocked",
      hasPrivateStorage: false,
    }),
    item("external-fallback", "External Fallback", {
      playbackUrl:
        "/api/public/admission-share/mediaMatrix/recordings/external-fallback",
      externalUrl: "https://video.example.test/fallback/task11",
      sourceHealth: "original_with_external_fallback",
      hasPrivateStorage: true,
    }),
  ];
}

async function openMediaItem(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(name) })
    .first()
    .click();
  await expect(
    page
      .getByRole("region", { name: "录屏播放器" })
      .locator("header")
      .getByRole("heading", { name, exact: true }),
  ).toBeVisible();
}

async function startVideo(
  page: Page,
  name: string,
  key: "Enter" | "Space",
  width: number,
  height: number,
) {
  await page.getByRole("button", { name: "播放录屏" }).press(key);
  const video = page.locator(`video[aria-label="${name} 原始录屏播放器"]`);
  await expect(video).toBeAttached();
  await video.evaluate(
    (element, dimensions) => {
      Object.defineProperty(element, "videoWidth", {
        configurable: true,
        value: dimensions.width,
      });
      Object.defineProperty(element, "videoHeight", {
        configurable: true,
        value: dimensions.height,
      });
      element.dispatchEvent(new Event("loadedmetadata"));
      element.dispatchEvent(new Event("canplay"));
    },
    { width, height },
  );
  await expect(video).toBeVisible();
  await expect(video).toBeFocused();
}

async function assertLightStageAndScreenshot(page: Page, path: string) {
  const stage = page.getByRole("region", { name: "录屏媒体工作区" });
  await expect(stage).toBeVisible();
  const background = await stage.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(background).not.toBe("rgb(0, 0, 0)");
  expect(background).not.toBe("rgba(0, 0, 0, 1)");
  const stageBox = await stage.boundingBox();
  const workspaceBox = await page
    .getByRole("region", { name: "录屏复核工作台" })
    .boundingBox();
  expect(stageBox?.width ?? 0).toBeLessThan(
    workspaceBox?.width ?? Number.MAX_SAFE_INTEGER,
  );
  await stage.screenshot({ path, animations: "disabled" });
}

function ownerStudio(brand: typeof baseBrand) {
  return {
    organization: { id: ORGANIZATION_ID, name: "星耀 MCN" },
    published: brand,
    draft: {
      baseVersion: brand.version,
      persisted: true,
      updatedAt: "2026-08-02T07:00:00.000Z",
      content: {
        logoText: brand.logoText,
        logoStoragePath: null,
        brandName: `${brand.brandName}草稿`,
        brandTagline: brand.brandTagline,
        primaryColor: brand.primaryColor,
      },
    },
    versions: [
      {
        version: brand.version,
        publishedAt: brand.publishedAt,
        brand,
        publishedByLabel: "Owner Visual",
      },
    ],
    contactCards: [contactCard, disabledContactCard],
    permissions: { canManageBrand: true },
  };
}

function publicBrand(brand: typeof baseBrand) {
  return {
    version: brand.version,
    logoText: brand.logoText,
    logoUrl: `/api/public/admission-share/oldSnapshot/brand-logo`,
    brandName: brand.brandName,
    brandTagline: brand.brandTagline,
    primaryColor: brand.primaryColor,
  };
}

function persistedPresentation(overrides: Record<string, unknown> = {}) {
  return {
    id: "share-persisted",
    brandVersion: 4,
    contactCardId: null,
    title: "Persisted review",
    purpose: "Service snapshot",
    mode: "formal_review",
    status: "active",
    reviewState: "not_started",
    roundNumber: 2,
    expiresAt: "2099-08-01T00:00:00.000Z",
    project: { id: "project-1", name: "Task11 Project", code: "TASK11-01" },
    progress: { completed: 0, total: 1 },
    latestSubmission: null,
    brand: publicBrand(publishedBrand),
    contactCard: null,
    items: [
      {
        applicationId: "application-1",
        recordingSubmissionId: "recording-1",
        recordingVersion: 2,
        sourceHealth: "original_ready",
        streamer: {
          id: "streamer-1",
          displayName: "Streamer One",
          accountLabel: "streamer_one",
        },
        finalReview: null,
      },
    ],
    ...overrides,
  };
}

function admissionProjectBoard() {
  return {
    project: {
      id: "project-1",
      code: "TASK11-01",
      name: "Task11 Project",
      status: "active",
      vendor: "Brand Partner",
      product: "Product A",
    },
    counts: {
      totalApplications: 1,
      recordingCount: 1,
      mcnPendingReview: 0,
      mcnApproved: 1,
      mcnRejected: 0,
      needsChanges: 0,
      vendorPending: 1,
      vendorSelected: 0,
      vendorBackup: 0,
      vendorRejected: 0,
      vendorNeedsChanges: 0,
      pendingFinalConfirm: 0,
    },
    share: {
      id: "share-old",
      mode: "formal_review",
      status: "active",
      reviewState: "not_started",
      roundNumber: 1,
      expiresAt: "2099-08-01T00:00:00.000Z",
      lastViewedAt: null,
      lastDraftAt: null,
      lastSubmittedAt: null,
      lockedAt: null,
    },
    shareProgress: { completed: 0, total: 1 },
    lastActivityAt: "2026-08-01T00:00:00.000Z",
  };
}

async function setServerMode(
  request: {
    post(url: string, options?: { data?: unknown }): Promise<{ ok(): boolean }>;
  },
  mode: ServerMode,
) {
  const response = await request.post(`${MOCK_URL}/__task11/mode`, {
    data: mode,
  });
  expect(response.ok()).toBeTruthy();
}

async function setStaffSession(
  context: BrowserContext,
  role: "owner" | "finance",
) {
  await context.clearCookies();
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value: visualSessionCookie(role),
      url: APP_URL,
      sameSite: "Lax",
    },
  ]);
}

function visualSessionCookie(role: "owner" | "finance") {
  const userId = role === "owner" ? OWNER_ID : MEMBER_ID;
  const accessToken = createVisualJwt({ sub: userId, visual_role: role });
  const session = {
    access_token: accessToken,
    refresh_token: `task11-${role}-refresh`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: "bearer",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: `${role}@task11.example.test`,
    },
  };
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

function createVisualJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    role: "authenticated",
    ...payload,
  })}.task11-signature`;
}

function roleFromRequest(request: IncomingMessage) {
  const token = String(request.headers.authorization ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    return payload.visual_role === "finance" ? "finance" : "owner";
  } catch {
    return "owner";
  }
}

function contactCardRow() {
  return {
    id: contactCard.id,
    organization_id: ORGANIZATION_ID,
    display_name: contactCard.displayName,
    title: contactCard.title,
    phone: contactCard.phone,
    email: contactCard.email,
    wechat: contactCard.wechat,
    status: "active",
    created_by: OWNER_ID,
    updated_by: OWNER_ID,
    created_at: contactCard.createdAt,
    updated_at: contactCard.updatedAt,
  };
}

function disabledCardRow() {
  return {
    ...contactCardRow(),
    id: disabledContactCard.id,
    display_name: disabledContactCard.displayName,
    status: "disabled",
  };
}

function postgrest(
  response: ServerResponse,
  request: IncomingMessage,
  value: unknown,
) {
  const singular = String(request.headers.accept ?? "").includes(
    "vnd.pgrst.object",
  );
  return json(response, 200, singular ? value : value == null ? [] : [value]);
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function waitForApp() {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${APP_URL}/login`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Next has not opened the socket yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  }
  throw new Error("Task11 Next server did not become ready");
}

async function warmConsole(mode: ServerMode) {
  const expectedShell = mode.opsV2 ? "ops-v2-shell" : "ops-reference-shell";
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${APP_URL}/console`, {
        headers: {
          Cookie: `sb-127-auth-token=${visualSessionCookie("owner")}`,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.text();
      if (response.ok && body.includes(expectedShell)) return;
    } catch {
      // The first route compilation can close a dev-server request; retry it.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  }
  throw new Error(`Task11 Next server did not render ${expectedShell}`);
}

async function waitForAppToStop() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${APP_URL}/login`, {
        redirect: "manual",
        signal: AbortSignal.timeout(1_000),
      });
    } catch {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(
    `Task11 Next server still owns ${APP_URL} after exact process-tree stop`,
  );
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) =>
    child.once("exit", () => resolveExit()),
  );
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolveKill) =>
      killer.once("exit", () => resolveKill()),
    );
  } else {
    child.kill("SIGTERM");
  }
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolveTimeout) =>
      setTimeout(() => resolveTimeout(false), 5_000),
    ),
  ]);
  if (!graceful && child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
