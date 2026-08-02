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
const LANDSCAPE_WEBM_BASE64 =
  "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";
const PORTRAIT_WEBM_BASE64 =
  "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";

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

const serverPersistedBrand = {
  ...publishedBrand,
  version: 41,
  logoText: "云证",
  brandName: "云证专业交付",
  brandTagline: "服务端固化的专业复核快照",
  primaryColor: "#0F766E",
  actionColor: "#115E59",
  softColor: "#CCFBF1",
  publishedAt: "2026-08-02T09:15:00.000Z",
};

const serverPersistedContactCard = {
  ...contactCard,
  displayName: "周顾问（服务端快照）",
  title: "品牌交付顾问",
  phone: "13900000000",
  email: "zhou.persisted@example.test",
  wechat: "persisted-zhou",
  updatedAt: "2026-08-02T09:15:00.000Z",
};

type ServerMode = {
  opsV2: boolean;
  brandUi: boolean;
};

type MockState = {
  brand: typeof baseBrand;
  mode: ServerMode;
  unexpectedRequests: string[];
};

type ConsoleShareRouteControl = {
  waitForFirstPreflight: () => Promise<void>;
  releaseFirstPreflight: () => void;
};

type VisualRole = "owner" | "finance" | "service";

const emptyDashboardRestQueryKeys: Record<string, readonly string[]> = {
  project_applications: ["select", "organization_id", "order"],
  live_tasks: ["select", "organization_id", "order", "limit"],
  live_reports: [
    "select",
    "status",
    "organization_id",
    "order",
    "limit",
    "enter_settlement_pool",
    "created_at",
  ],
  settlement_batches: ["select", "organization_id", "order", "limit"],
  notifications: ["select", "organization_id", "or", "order", "limit"],
  projects: [
    "select",
    "organization_id",
    "settlement_batches.limit",
    "live_reports.status",
    "live_reports.settled_batch_item_id",
    "live_reports.or",
    "live_reports.limit",
    "order",
    "limit",
  ],
  ai_conversations: [
    "select",
    "organization_id",
    "owner_user_id",
    "status",
    "order",
    "limit",
  ],
  ai_drafts: ["select", "organization_id", "status", "order", "limit"],
  marketplace_applications: [
    "select",
    "status",
    "applicant_organization_id",
    "order",
    "limit",
  ],
  marketplace_postings: [
    "select",
    "organization_id",
    "status",
    "order",
    "limit",
  ],
};

const task11RestQueryKeys: Record<string, readonly string[]> = {
  profiles: ["select", "id"],
  organization_members: ["select", "user_id", "status", "order"],
  organizations: ["select", "id"],
  organization_brand_drafts: ["select", "organization_id"],
  organization_brand_versions: ["select", "organization_id", "order", "limit"],
  organization_contact_cards: ["select", "organization_id", "status", "order"],
  ...emptyDashboardRestQueryKeys,
};

const unexpectedBrowserRequests = new WeakMap<Page, string[]>();

if (process.argv.includes("--serve-task11")) {
  void serveTask11();
} else {
  defineBrowserTests();
}

async function serveTask11() {
  const state: MockState = {
    brand: structuredClone(baseBrand),
    mode: { opsV2: false, brandUi: true },
    unexpectedRequests: [],
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
        state.unexpectedRequests = [];
        return json(response, 200, { ok: true });
      }
      if (url.pathname === "/__task11/unexpected" && request.method === "GET") {
        const unexpected = [...state.unexpectedRequests];
        if (url.searchParams.get("clear") === "1") {
          state.unexpectedRequests = [];
        }
        return json(response, 200, { unexpected });
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
        if (request.method !== "GET") {
          return rejectUnexpectedRest(state, response, request, url);
        }
        if (role !== "owner" && role !== "finance") {
          return json(response, 401, { message: "invalid visual session" });
        }
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
      if (url.pathname.startsWith("/rest/v1/")) {
        const role = roleFromRequest(request);
        if (!role) {
          return json(response, 401, { message: "invalid visual session" });
        }
        if (!isAllowedRestRequest(request, url)) {
          return rejectUnexpectedRest(state, response, request, url);
        }
        const fixtureRole = role === "finance" ? "finance" : "owner";
        if (url.pathname === "/rest/v1/profiles") {
          return postgrest(response, request, {
            full_name:
              fixtureRole === "owner" ? "Owner Visual" : "Member Visual",
            requires_onboarding: false,
            avatar_text: fixtureRole === "owner" ? "OV" : "MV",
            avatar_url: null,
          });
        }
        if (url.pathname === "/rest/v1/organization_members") {
          return json(response, 200, [
            {
              organization_id: ORGANIZATION_ID,
              role: fixtureRole,
              created_at: "2026-08-01T00:00:00.000Z",
              organizations: {
                name: "星耀 MCN",
                branding: state.brand,
              },
            },
          ]);
        }
        if (url.pathname === "/rest/v1/organizations") {
          return postgrest(response, request, {
            id: ORGANIZATION_ID,
            name: "星耀 MCN",
            branding: state.brand,
            branding_version: state.brand.version,
          });
        }
        if (url.pathname === "/rest/v1/organization_brand_drafts") {
          return postgrest(
            response,
            request,
            fixtureRole === "owner"
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
        if (url.pathname === "/rest/v1/organization_brand_versions") {
          return json(response, 200, [
            {
              organization_id: ORGANIZATION_ID,
              version: state.brand.version,
              content: state.brand,
              published_by: OWNER_ID,
              published_at:
                state.brand.publishedAt ?? "2026-08-01T08:00:00.000Z",
            },
          ]);
        }
        if (url.pathname === "/rest/v1/organization_contact_cards") {
          const cards =
            fixtureRole === "owner"
              ? [contactCardRow(), disabledCardRow()]
              : [contactCardRow()];
          return json(response, 200, cards);
        }
        if (
          Object.hasOwn(
            emptyDashboardRestQueryKeys,
            url.pathname.slice("/rest/v1/".length),
          )
        ) {
          return json(response, 200, [], { "Content-Range": "0-0/0" });
        }
        return rejectUnexpectedRest(state, response, request, url);
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

  test.beforeEach(async ({ page, request }, testInfo) => {
    testInfo.setTimeout(120_000);
    unexpectedBrowserRequests.set(page, []);
    await expect(
      (await request.post(`${MOCK_URL}/__task11/reset`)).ok(),
    ).toBeTruthy();
    await setServerMode(request, { opsV2: false, brandUi: true });
  });

  test.afterEach(async ({ page, request }) => {
    expect(unexpectedBrowserRequests.get(page) ?? []).toEqual([]);
    const response = await request.get(
      `${MOCK_URL}/__task11/unexpected?clear=1`,
    );
    expect(response.ok()).toBeTruthy();
    const audit = (await response.json()) as { unexpected: string[] };
    expect(audit.unexpected).toEqual([]);
  });

  test("owner publishes once and both console shells refresh while members stay read-only", async ({
    page,
    request,
  }) => {
    await expect((await request.get(`${MOCK_URL}/auth/v1/user`)).status()).toBe(
      401,
    );
    await expect(
      (
        await request.get(`${MOCK_URL}/auth/v1/user`, {
          headers: { Authorization: "Bearer invalid" },
        })
      ).status(),
    ).toBe(401);
    const serviceHeaders = {
      Authorization: "Bearer task11-visual-service-role-key",
    };
    await expect(
      (
        await request.get(`${MOCK_URL}/rest/v1/not_allowed?select=*`, {
          headers: serviceHeaders,
        })
      ).status(),
    ).toBe(404);
    await expect(
      (
        await request.post(`${MOCK_URL}/rest/v1/profiles?select=*`, {
          headers: serviceHeaders,
        })
      ).status(),
    ).toBe(404);
    await expect(
      (
        await request.get(`${MOCK_URL}/rest/v1/profiles?select=*&evil=1`, {
          headers: serviceHeaders,
        })
      ).status(),
    ).toBe(404);
    const rejectedRest = await request.get(
      `${MOCK_URL}/__task11/unexpected?clear=1`,
    );
    expect(rejectedRest.ok()).toBeTruthy();
    expect((await rejectedRest.json()).unexpected).toEqual([
      "GET /rest/v1/not_allowed?select=*",
      "POST /rest/v1/profiles?select=*",
      "GET /rest/v1/profiles?select=*&evil=1",
    ]);

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
    const shareRoutes = await installConsoleShareRoutes(page, capturedCreates);
    await openShareCenter(page);

    const rejectedFixtureStatuses = await page.evaluate(async () =>
      Promise.all([
        fetch("/api/task11-not-allowed").then((response) => response.status),
        fetch("/api/applications", { method: "POST" }).then(
          (response) => response.status,
        ),
        fetch("/api/organization/brand?unexpected=1").then(
          (response) => response.status,
        ),
      ]),
    );
    expect(rejectedFixtureStatuses).toEqual([404, 404, 404]);
    expect(takeUnexpectedBrowserRequests(page)).toEqual([
      "GET /api/task11-not-allowed",
      "POST /api/applications",
      "GET /api/organization/brand?unexpected=1",
    ]);

    const createButton = page.getByRole("button", { name: "创建分享" });
    await page.getByRole("checkbox", { name: /选择 Streamer One/ }).check();
    await createButton.focus();
    await createButton.press("Enter");
    const wizard = page.getByRole("dialog", { name: "创建录屏分享" });
    await expect(wizard).toBeVisible();
    await shareRoutes.waitForFirstPreflight();
    await expect(wizard).toContainText("正在逐条检查录屏状态");
    await wizard.getByRole("button", { name: "关闭创建向导" }).press("Escape");
    await expect(wizard).toHaveCount(0);
    await expect(createButton).toBeEnabled();
    await expect(createButton).toBeFocused();

    const stalePreflightResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "POST" &&
        url.pathname.endsWith("/admission-share-boards/preflight")
      );
    });
    shareRoutes.releaseFirstPreflight();
    await stalePreflightResponse;
    await page.evaluate(
      () =>
        new Promise<void>((resolveFrame) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolveFrame()),
          );
        }),
    );
    await expect(wizard).toHaveCount(0);
    await expect(page.getByText(/分享预检失败/)).toHaveCount(0);
    await expect(createButton).toBeEnabled();
    await expect(createButton).toBeFocused();

    const focusAfterWizardEscape = await page.evaluate(() => ({
      tagName: document.activeElement?.tagName ?? null,
      ariaLabel: document.activeElement?.getAttribute("aria-label") ?? null,
      text: document.activeElement?.textContent?.trim().slice(0, 80) ?? null,
      createEnabled:
        document.activeElement instanceof HTMLButtonElement
          ? !document.activeElement.disabled
          : null,
      staleWizardPresent: Boolean(
        document.querySelector('[role="dialog"][aria-label="创建录屏分享"]'),
      ),
    }));
    await testInfo.attach("wizard-focus-return-verified", {
      body: JSON.stringify(focusAfterWizardEscape, null, 2),
      contentType: "application/json",
    });
    await writeFile(
      testInfo.outputPath("wizard-focus-return-verified.json"),
      `${JSON.stringify(focusAfterWizardEscape, null, 2)}\n`,
      "utf8",
    );
    await page.screenshot({
      path: testInfo.outputPath("wizard-focus-return-verified.png"),
    });

    await createButton.press("Enter");
    await wizard.getByRole("button", { name: "下一步" }).click();
    await expect(
      wizard.getByRole("region", { name: "将要创建的外部分享预览" }),
    ).toContainText("联系方式：不展示");
    await wizard.getByRole("button", { name: "确认生成" }).click();
    const delivery = page.getByRole("dialog", { name: "一次性交付信息" });
    await expect(delivery).toContainText("服务端已保存：无名片");
    await expect(delivery).toContainText(serverPersistedBrand.brandName);
    await expect(delivery).not.toContainText(publishedBrand.brandName);
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
    await expect(delivery).toContainText(serverPersistedBrand.brandName);
    await expect(delivery).toContainText(
      serverPersistedContactCard.displayName,
    );
    await expect(delivery).not.toContainText(contactCard.displayName);
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
    await expect(oldPreview).not.toContainText(serverPersistedBrand.brandName);
    await expect(oldPreview).toContainText(disabledContactCard.displayName);
    await expect(oldPreview).not.toContainText(
      serverPersistedContactCard.displayName,
    );
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
    const board = publicBoard({
      brand: {
        ...publicBrand(publishedBrand),
        logoUrl: "/api/public/admission-share/protectedShare/brand-logo",
      },
      items: [mediaItems("protectedShare")[0]],
    });
    const publicAudit = await installPublicRoutes(page, {
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
    const preAuthenticationStatuses = await page.evaluate(async () =>
      Promise.all([
        fetch("/api/public/admission-share/protectedShare/brand-logo").then(
          (response) => response.status,
        ),
        fetch(
          "/api/public/admission-share/protectedShare/recordings/original-landscape",
        ).then((response) => response.status),
        fetch("/api/public/admission-share/protectedShare/drafts").then(
          (response) => response.status,
        ),
        fetch("/api/public/admission-share/protectedShare/access").then(
          (response) => response.status,
        ),
        fetch("/api/public/admission-share/protectedShare/unknown").then(
          (response) => response.status,
        ),
      ]),
    );
    expect(preAuthenticationStatuses).toEqual([401, 401, 401, 404, 404]);
    expect(publicAudit.servedProtectedResources).toEqual([]);
    expect(takeUnexpectedBrowserRequests(page)).toEqual([
      "GET /api/public/admission-share/protectedShare/access",
      "GET /api/public/admission-share/protectedShare/unknown",
    ]);

    await accessCode.fill("wrong-access-code");
    await page.getByRole("button", { name: "验证访问码" }).click();
    await expect(
      page.getByRole("alert", { name: "访问码验证错误" }),
    ).toContainText("访问码错误");
    await expect(accessCode).toBeFocused();
    await accessCode.fill("visual-access-code");
    await page.getByRole("button", { name: "验证访问码" }).click();
    await expect(
      page.getByRole("region", { name: "录屏复核工作台" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/protectedShare$/);
    const postAuthenticationStatuses = await page.evaluate(async () =>
      Promise.all([
        fetch("/api/public/admission-share/protectedShare/brand-logo").then(
          (response) => response.status,
        ),
        fetch(
          "/api/public/admission-share/protectedShare/recordings/original-landscape",
        ).then((response) => response.status),
        fetch("/api/public/admission-share/protectedShare/drafts").then(
          (response) => response.status,
        ),
      ]),
    );
    expect(postAuthenticationStatuses).toEqual([200, 200, 200]);
    expect(publicAudit.servedProtectedResources).toEqual(
      expect.arrayContaining([
        "GET /api/public/admission-share/protectedShare/brand-logo",
        "GET /api/public/admission-share/protectedShare/recordings/original-landscape",
        "GET /api/public/admission-share/protectedShare/drafts",
      ]),
    );

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
    await startVideo(page, "Original Landscape", "Enter", 160, 90);
    await assertLightStageAndScreenshot(
      page,
      testInfo.outputPath("media-original-landscape.png"),
    );

    await openMediaItem(page, "Original Portrait");
    await startVideo(page, "Original Portrait", "Space", 90, 160);
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
    await expect(embed).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/task11",
    );
    await expect(embed).toHaveAttribute("tabindex", "0");
    await expect(embed).not.toHaveAttribute("aria-hidden", "true");
    await expect(
      embed.contentFrame().locator('[data-task11-controlled-embed="ready"]'),
    ).toHaveText("Task11 controlled embed ready");
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
    const board = publicBoard({ items: mediaItems("responsive").slice(0, 2) });
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
      const overflow = await page.evaluate(() => ({
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      }));
      expect(overflow.rootScrollWidth).toBeLessThanOrEqual(
        overflow.rootClientWidth + 1,
      );
      expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(
        overflow.bodyClientWidth + 1,
      );
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
    const closeDrawer = drawer.getByRole("button", { name: "关闭录屏列表" });
    const filterPending = drawer.getByRole("button", { name: "只看待判断" });
    await expect(closeDrawer).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(filterPending).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(closeDrawer).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      drawer.getByRole("button", { name: /Original Portrait/ }),
    ).toBeFocused();
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
    await startVideo(page, "Original Landscape", "Space", 160, 90);

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
      flagOff: { board: publicBoard({ items: [mediaItems("flagOff")[0]] }) },
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
): Promise<ConsoleShareRouteControl> {
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
  let shouldHoldFirstPreflight = true;
  let releaseFirstPreflightRequest: (() => void) | null = null;
  let markFirstPreflightStarted = () => {};
  const firstPreflightStarted = new Promise<void>((resolveStarted) => {
    markFirstPreflightStarted = resolveStarted;
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (!isAllowedConsoleRequest(request.method(), url)) {
      return rejectBrowserRequest(page, route);
    }
    if (pathname === "/api/applications/admission-board") {
      return fulfillJson(route, {
        projects: [admissionProjectBoard()],
      });
    }
    if (pathname === "/api/applications")
      return fulfillJson(route, { applications: [] });
    if (pathname === "/api/admission-review/metrics")
      return fulfillJson(route, { metrics: [] });
    if (pathname === "/api/ai/conversations")
      return fulfillJson(route, { conversations: [] });
    if (pathname === "/api/ai/drafts")
      return fulfillJson(route, { drafts: [] });
    if (pathname === "/api/marketplace/intel")
      return fulfillJson(route, { intel: [] });
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
      if (shouldHoldFirstPreflight) {
        shouldHoldFirstPreflight = false;
        markFirstPreflightStarted();
        await new Promise<void>((resolvePending) => {
          releaseFirstPreflightRequest = resolvePending;
        });
      }
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
          body.contactCardId === CONTACT_CARD_ID
            ? serverPersistedContactCard
            : null;
        return fulfillJson(route, {
          shareBoard: {
            id: `share-created-${createdCount}`,
            mode: body.mode,
            presentation: persistedPresentation({
              id: `share-created-${createdCount}`,
              title: `服务端已保存：${selectedContact ? "带名片" : "无名片"}`,
              brandVersion: serverPersistedBrand.version,
              contactCardId: selectedContact?.id ?? null,
              brand: publicBrand(serverPersistedBrand),
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
    return rejectBrowserRequest(page, route);
  });

  return {
    waitForFirstPreflight: () => firstPreflightStarted,
    releaseFirstPreflight: () => {
      if (!releaseFirstPreflightRequest) {
        throw new Error("The first share preflight request is not pending");
      }
      const release = releaseFirstPreflightRequest;
      releaseFirstPreflightRequest = null;
      release();
    },
  };
}

function isAllowedConsoleRequest(method: string, url: URL) {
  const noQuery = url.search === "";
  const exact = (pathname: string, expectedMethod = "GET") =>
    url.pathname === pathname && method === expectedMethod && noQuery;

  if (exact("/api/applications")) return true;
  if (exact("/api/applications/admission-board")) return true;
  if (
    url.pathname === "/api/admission-review/metrics" &&
    method === "GET" &&
    url.searchParams.size === 1 &&
    url.searchParams.get("limit") === "200"
  ) {
    return true;
  }
  if (exact("/api/organization/brand")) return true;
  if (exact("/api/organization/contact-cards")) return true;
  if (exact("/api/ai/conversations")) return true;
  if (
    url.pathname === "/api/ai/drafts" &&
    method === "GET" &&
    url.searchParams.size === 1 &&
    url.searchParams.get("status") === "pending"
  ) {
    return true;
  }
  if (exact("/api/marketplace/intel")) return true;
  if (
    exact("/api/projects/project-1/admission-share-candidates") ||
    exact("/api/projects/project-1/admission-share-boards/preflight", "POST") ||
    exact("/api/projects/project-1/admission-share-boards", "POST")
  ) {
    return true;
  }
  if (
    url.pathname === "/api/projects/project-1/admission-share-boards" &&
    method === "GET"
  ) {
    return (
      noQuery ||
      (url.searchParams.size === 1 &&
        url.searchParams.get("boardId") === "share-old")
    );
  }
  return (
    url.pathname ===
      "/api/projects/project-1/admission-share-playback-issues" &&
    method === "GET" &&
    url.searchParams.size === 1 &&
    url.searchParams.get("status") === "open"
  );
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

type PublicRouteAudit = {
  servedProtectedResources: string[];
};

async function installPublicRoutes(
  page: Page,
  fixtures: Record<string, PublicRouteFixture>,
) {
  const authenticated = new Set<string>();
  const audit: PublicRouteAudit = { servedProtectedResources: [] };
  await page.route("**/api/public/admission-share/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/").filter(Boolean);
    const token = decodeURIComponent(parts[3] ?? "");
    const fixture = fixtures[token];
    if (!fixture)
      return fulfillJson(route, { code: "NOT_FOUND", error: "Not found" }, 404);
    const suffix = parts.slice(4);

    if (suffix.length === 1 && suffix[0] === "access") {
      if (
        request.method() !== "POST" ||
        url.search ||
        !request.headers()["content-type"]?.startsWith("application/json")
      ) {
        return rejectBrowserRequest(page, route);
      }
      const body = safePostDataJson(request.postData());
      if (
        !isRecord(body) ||
        Object.keys(body).length !== 1 ||
        body.accessCode !== "visual-access-code"
      ) {
        return fulfillJson(
          route,
          { code: "ACCESS_CODE_INVALID", error: "访问码错误，请重新输入。" },
          401,
        );
      }
      authenticated.add(token);
      return fulfillJson(route, { authenticated: true });
    }

    if (!isAllowedPublicRequest(request.method(), url, suffix)) {
      return rejectBrowserRequest(page, route);
    }

    if (fixture.error) {
      return fulfillJson(route, fixture.error, fixture.error.status);
    }
    if (fixture.accessRequired && !authenticated.has(token)) {
      return fulfillJson(
        route,
        { code: "ACCESS_CODE_REQUIRED", error: "请输入访问码后继续。" },
        401,
      );
    }
    if (fixture.accessRequired && suffix.length > 0) {
      audit.servedProtectedResources.push(
        `${request.method()} ${url.pathname}${url.search}`,
      );
    }

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
      const recordingId = suffix[1] ?? "";
      if (["original-failure", "external-fallback"].includes(recordingId)) {
        return route.abort("failed");
      }
      const fixture =
        recordingId === "original-portrait"
          ? PORTRAIT_WEBM_BASE64
          : LANDSCAPE_WEBM_BASE64;
      await new Promise((resolveMedia) => setTimeout(resolveMedia, 150));
      return route.fulfill({
        status: 200,
        contentType: "video/webm",
        body: Buffer.from(fixture, "base64"),
      });
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
    return fulfillJson(route, {
      shareBoard: fixture.board,
      vendorCheckpoints: [],
    });
  });

  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: [
        "<!doctype html>",
        '<html lang="en">',
        '<head><meta charset="utf-8"><title>Task11 controlled embed</title></head>',
        '<body><main data-task11-controlled-embed="ready">',
        "Task11 controlled embed ready",
        "</main></body></html>",
      ].join(""),
    }),
  );
  return audit;
}

function isAllowedPublicRequest(method: string, url: URL, suffix: string[]) {
  if (url.search) return false;
  if (suffix.length === 0) return method === "GET";
  if (suffix.length === 1 && suffix[0] === "brand-logo") {
    return method === "GET";
  }
  if (suffix.length === 1 && suffix[0] === "drafts") {
    return method === "GET";
  }
  if (suffix.length === 2 && suffix[0] === "drafts") {
    return method === "PUT" && Boolean(suffix[1]);
  }
  if (suffix.length === 2 && suffix[0] === "recordings") {
    return method === "GET" && Boolean(suffix[1]);
  }
  return (
    suffix.length === 3 &&
    suffix[0] === "recordings" &&
    Boolean(suffix[1]) &&
    suffix[2] === "issues" &&
    method === "POST"
  );
}

function safePostDataJson(postData: string | null): unknown {
  if (!postData) return null;
  try {
    return JSON.parse(postData);
  } catch {
    return null;
  }
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

function mediaItems(token = "mediaMatrix") {
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
      playbackUrl: `/api/public/admission-share/${token}/recordings/original-landscape`,
      externalUrl: null,
      sourceHealth: "original_ready",
      hasPrivateStorage: true,
    }),
    item("original-portrait", "Original Portrait", {
      playbackUrl: `/api/public/admission-share/${token}/recordings/original-portrait`,
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
      playbackUrl: `/api/public/admission-share/${token}/recordings/original-failure`,
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
      playbackUrl: `/api/public/admission-share/${token}/recordings/external-fallback`,
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
  await expect(
    page.getByRole("status", { name: "录屏加载状态" }),
  ).toContainText("正在加载");
  const video = page.locator(`video[aria-label="${name} 原始录屏播放器"]`);
  await expect(video).toBeAttached();
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(3);
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0);
  const media = await video.evaluate((element) => {
    const videoElement = element as HTMLVideoElement;
    return {
      paused: videoElement.paused,
      videoWidth: videoElement.videoWidth,
      videoHeight: videoElement.videoHeight,
    };
  });
  expect(media).toEqual({
    paused: false,
    videoWidth: width,
    videoHeight: height,
  });
  await expect(
    page
      .getByRole("region", { name: "录屏媒体工作区" })
      .locator(".recording-media-canvas"),
  ).toHaveAttribute(
    "data-orientation",
    height > width ? "portrait" : "landscape",
  );
  const frame = await video.evaluate((element) => {
    const videoElement = element as HTMLVideoElement;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { nonBlackRatio: 0, paletteSize: 0 };
    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonBlack = 0;
    const palette = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      if (red > 24 || green > 24 || blue > 24) nonBlack += 1;
      palette.add(`${red >> 5}:${green >> 5}:${blue >> 5}`);
    }
    return {
      nonBlackRatio: nonBlack / (pixels.length / 4),
      paletteSize: palette.size,
    };
  });
  expect(frame.nonBlackRatio).toBeGreaterThan(0.8);
  expect(frame.paletteSize).toBeGreaterThan(3);
  await expect(video).toBeVisible();
  await expect(video).toBeFocused();
}

async function assertLightStageAndScreenshot(page: Page, path: string) {
  const stage = page.getByRole("region", { name: "录屏媒体工作区" });
  await expect(stage).toBeVisible();
  const luminances = await page
    .locator('[aria-label="录屏媒体工作区"], .recording-media-canvas')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const ownBackground = getComputedStyle(element).backgroundColor;
        let current: Element | null = element;
        let channels: number[] = [];
        let channelsAreNormalized = false;
        while (current) {
          const background = getComputedStyle(current).backgroundColor;
          channels = (background.match(/[\d.]+/g) ?? []).map(Number);
          channelsAreNormalized = background.startsWith("color(srgb ");
          const alpha = channels[3] ?? 1;
          if (channels.length >= 3 && alpha >= 0.95) break;
          current = current.parentElement;
        }
        const rgb = (
          channels.slice(0, 3).length === 3
            ? channels.slice(0, 3)
            : [255, 255, 255]
        ).map((channel) => {
          const normalized = channelsAreNormalized ? channel : channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return {
          selector:
            element.getAttribute("aria-label") ??
            element.getAttribute("class") ??
            element.tagName,
          ownBackground,
          effectiveBackground: channels.join(","),
          luminance: 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!,
        };
      }),
    );
  expect(luminances).toHaveLength(2);
  for (const surface of luminances) {
    expect(surface.luminance, JSON.stringify(surface)).toBeGreaterThanOrEqual(
      0.35,
    );
  }
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

function roleFromRequest(request: IncomingMessage): VisualRole | null {
  const authorization = String(request.headers.authorization ?? "");
  if (!/^Bearer\s+\S+$/i.test(authorization)) return null;
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (token === "task11-visual-service-role-key") return "service";
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      payload.aud !== "authenticated" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000) ||
      ![OWNER_ID, MEMBER_ID].includes(String(payload.sub ?? ""))
    ) {
      return null;
    }
    if (payload.visual_role === "owner" && payload.sub === OWNER_ID) {
      return "owner";
    }
    if (payload.visual_role === "finance" && payload.sub === MEMBER_ID) {
      return "finance";
    }
    return null;
  } catch {
    return null;
  }
}

function isAllowedRestRequest(request: IncomingMessage, url: URL) {
  if (request.method !== "GET") return false;
  const table = url.pathname.slice("/rest/v1/".length);
  const allowedKeys = task11RestQueryKeys[table];
  if (!allowedKeys || !url.searchParams.has("select")) return false;
  const keys = [...new Set(url.searchParams.keys())];
  if (keys.some((key) => !allowedKeys.includes(key))) return false;

  for (const [key, value] of url.searchParams) {
    if (key === "organization_id" && value !== `eq.${ORGANIZATION_ID}`) {
      return false;
    }
    if (key === "id") {
      const expectedIds =
        table === "organizations"
          ? [`eq.${ORGANIZATION_ID}`]
          : [`eq.${OWNER_ID}`, `eq.${MEMBER_ID}`];
      if (!expectedIds.includes(value)) return false;
    }
    if (
      key === "user_id" &&
      ![`eq.${OWNER_ID}`, `eq.${MEMBER_ID}`].includes(value)
    ) {
      return false;
    }
  }
  return true;
}

function rejectUnexpectedRest(
  state: MockState,
  response: ServerResponse,
  request: IncomingMessage,
  url: URL,
) {
  const signature = `${request.method ?? "UNKNOWN"} ${url.pathname}${url.search}`;
  state.unexpectedRequests.push(signature);
  return json(response, 404, {
    code: "TASK11_FIXTURE_REJECTED",
    message: `fixture rejected ${signature}`,
  });
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

function rejectBrowserRequest(page: Page, route: Route) {
  const request = route.request();
  const url = new URL(request.url());
  const signature = `${request.method()} ${url.pathname}${url.search}`;
  const unexpected = unexpectedBrowserRequests.get(page) ?? [];
  unexpected.push(signature);
  unexpectedBrowserRequests.set(page, unexpected);
  return fulfillJson(
    route,
    {
      code: "TASK11_FIXTURE_REJECTED",
      error: `fixture rejected ${signature}`,
    },
    404,
  );
}

function takeUnexpectedBrowserRequests(page: Page) {
  const unexpected = [...(unexpectedBrowserRequests.get(page) ?? [])];
  unexpectedBrowserRequests.set(page, []);
  return unexpected;
}
