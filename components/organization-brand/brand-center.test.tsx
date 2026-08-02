import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OrganizationBrandCenter,
  prepareBrandLogoForUpload,
  type OrganizationBrandCenterProps,
} from "./brand-center";
import { OrganizationBrandMark } from "./organization-brand-mark";

const brandCenterCss = readFileSync(
  "components/organization-brand/brand-center.module.css",
  "utf8",
);

const published = {
  schemaVersion: 1 as const,
  version: 3,
  logoText: "星耀",
  logoStoragePath:
    "11111111-1111-4111-8111-111111111111/brand-logos/22222222-2222-4222-8222-222222222222.webp",
  brandName: "星耀经营舱",
  brandTagline: "专业直播项目管理",
  primaryColor: "#165DFF",
  actionColor: "#165DFF",
  softColor: "#E8F0FF",
  publishedAt: "2026-08-01T08:00:00.000Z",
  semantic: {
    success: "#00B42A" as const,
    warning: "#FF7D00" as const,
    danger: "#F53F3F" as const,
    info: "#165DFF" as const,
  },
};

const ownerStudio: OrganizationBrandCenterProps["initialStudio"] = {
  organization: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "星耀 MCN",
  },
  published,
  draft: {
    baseVersion: 3,
    persisted: true,
    updatedAt: "2026-08-01T09:00:00.000Z",
    content: {
      logoText: "星耀",
      logoStoragePath: published.logoStoragePath,
      brandName: "星耀经营舱草稿",
      brandTagline: "待发布的专业直播服务",
      primaryColor: "#1E50C8",
    },
  },
  versions: [
    {
      version: 3,
      publishedAt: published.publishedAt!,
      brand: published,
      publishedByLabel: "其他组织负责人",
    },
  ],
  contactCards: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      displayName: "王负责人",
      title: "商务负责人",
      phone: "13800000000",
      email: null,
      wechat: "xingyao",
      status: "active",
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:00:00.000Z",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      displayName: "旧联系人",
      title: "",
      phone: null,
      email: "legacy@example.com",
      wechat: null,
      status: "disabled",
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:00:00.000Z",
    },
  ],
  permissions: { canManageBrand: true },
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function renderOwner(props: Partial<OrganizationBrandCenterProps> = {}) {
  return render(
    <OrganizationBrandCenter
      initialStudio={ownerStudio}
      canEdit
      initialLogoUrls={{
        published: "https://signed.example/published",
        draft: "https://signed.example/draft",
      }}
      {...props}
    />,
  );
}

describe("OrganizationBrandCenter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback) => {
        callback(new Blob(["prepared-webp"], { type: "image/webp" }));
      },
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi
        .fn()
        .mockReturnValueOnce("blob:raw-logo")
        .mockReturnValue("blob:prepared-logo"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps simulated preview actions white and inside their own grid cell", () => {
    expect(brandCenterCss).toMatch(
      /\.previewTask\s+\.previewAction\s*,\s*\.publicPreview\s+footer\s+\.previewAction\s*\{[^}]*color:\s*#fff;/u,
    );
    expect(brandCenterCss).toMatch(
      /\.previewTask\s+\.previewAction\s*\{[^}]*grid-column:\s*auto;/u,
    );
  });

  it("shows owner governance controls, current publication and a clearly unpublished preview", () => {
    renderOwner();

    expect(screen.getByRole("heading", { name: "品牌中心" })).toBeVisible();
    expect(screen.getByText("当前线上版本 v3")).toBeVisible();
    expect(screen.getAllByText(/发布于/).length).toBeGreaterThan(0);
    expect(screen.getByText(/发布者 其他组织负责人/)).toBeVisible();
    expect(screen.getByText("未发布草稿")).toBeVisible();
    expect(screen.getByText("预览，不会在发布前影响线上")).toBeVisible();
    expect(screen.getByLabelText("品牌名称")).toHaveValue("星耀经营舱草稿");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeVisible();
    expect(screen.getByRole("button", { name: "准备发布" })).toBeVisible();
    expect(screen.getByText("联系名片管理")).toBeVisible();
  });

  it("renders members as published-only readers without draft, history or disabled cards", () => {
    render(
      <OrganizationBrandCenter
        initialStudio={{
          ...ownerStudio,
          draft: undefined,
          versions: undefined,
          contactCards: ownerStudio.contactCards.filter(
            (card) => card.status === "active",
          ),
          permissions: { canManageBrand: false },
        }}
        canEdit={false}
        initialLogoUrls={{ published: null, draft: null }}
      />,
    );

    expect(screen.getByText("当前已发布品牌")).toBeVisible();
    expect(screen.getByText("王负责人")).toBeVisible();
    expect(screen.queryByText("旧联系人")).not.toBeInTheDocument();
    expect(screen.queryByText("未发布草稿")).not.toBeInTheDocument();
    expect(screen.queryByText("发布历史")).not.toBeInTheDocument();
    expect(screen.queryByText(/发布者/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "保存草稿" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("联系名片管理")).not.toBeInTheDocument();
  });

  it("center-crops and converts an accepted source logo into a matching WebP file", async () => {
    const source = new File(["logo"], "square.source.png", {
      type: "image/png",
    });

    const result = await prepareBrandLogoForUpload(source);

    expect(result.name).toBe("square.source.webp");
    expect(result.type).toBe("image/webp");
    const context = vi.mocked(HTMLCanvasElement.prototype.getContext).mock
      .results[0]?.value as { drawImage: ReturnType<typeof vi.fn> };
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600 }),
      100,
      0,
      600,
      600,
      0,
      0,
      600,
      600,
    );
  });

  it("validates by Unicode code points and keeps upload, save and publication states separate", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        logoStoragePath:
          "11111111-1111-4111-8111-111111111111/brand-logos/55555555-5555-4555-8555-555555555555.webp",
        contentType: "image/webp",
      }),
    );
    renderOwner();

    fireEvent.change(screen.getByLabelText("LOGO 字标"), {
      target: { value: "一二三四五六七八九" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(screen.getByText("LOGO 字标最多 8 个字符。")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();

    const file = new File(["logo"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("上传完成，待保存"),
    );
    expect(screen.getByAltText("星耀经营舱草稿品牌标识")).toHaveAttribute(
      "src",
      "blob:prepared-logo",
    );
    expect(screen.getByText("当前线上版本 v3")).toBeVisible();
    expect(screen.queryByText("品牌已发布")).not.toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe("/api/organization/brand/logo");
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.body).toBeInstanceOf(FormData);
    expect(Array.from((init?.body as FormData).keys())).toEqual(["logo"]);
    const prepared = (init?.body as FormData).get("logo") as File;
    expect(prepared).toBeInstanceOf(File);
    expect(prepared.type).toBe("image/webp");
    expect(prepared.name).toBe("logo.webp");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:raw-logo");
  });

  it("associates every validation error, announces the first one and focuses its field", () => {
    renderOwner();
    const logoText = screen.getByLabelText("LOGO 字标");
    const brandName = screen.getByLabelText("品牌名称");
    const tagline = screen.getByLabelText("品牌副标");
    const color = screen.getByRole("textbox", { name: "品牌主色" });

    fireEvent.change(logoText, { target: { value: "一二三四五六七八九" } });
    fireEvent.change(brandName, { target: { value: " " } });
    fireEvent.change(tagline, { target: { value: "副".repeat(81) } });
    fireEvent.change(color, { target: { value: "#BAD" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(logoText).toHaveAttribute("aria-invalid", "true");
    expect(logoText).toHaveAttribute(
      "aria-describedby",
      "brand-logo-text-error",
    );
    expect(brandName).toHaveAttribute("aria-describedby", "brand-name-error");
    expect(tagline).toHaveAttribute("aria-describedby", "brand-tagline-error");
    expect(color).toHaveAttribute(
      "aria-describedby",
      "brand-primary-color-error",
    );
    expect(screen.getByText("LOGO 字标最多 8 个字符。")).toHaveAttribute(
      "id",
      "brand-logo-text-error",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "品牌资料校验失败：LOGO 字标最多 8 个字符。",
    );
    expect(logoText).toHaveFocus();

    fireEvent.change(logoText, { target: { value: "星耀" } });
    expect(logoText).not.toHaveAttribute("aria-describedby");
    expect(
      screen.queryByText("LOGO 字标最多 8 个字符。"),
    ).not.toBeInTheDocument();
  });

  it("lets an in-flight upload be cancelled without discarding the local draft", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    renderOwner();

    fireEvent.change(screen.getByLabelText("品牌名称"), {
      target: { value: "保留的本地草稿" },
    });
    fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
      target: {
        files: [new File(["logo"], "logo.png", { type: "image/png" })],
      },
    });
    expect(screen.getByRole("button", { name: "取消上传" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消上传" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "上传已取消，本地草稿已保留。",
      ),
    );
    expect(screen.getByLabelText("品牌名称")).toHaveValue("保留的本地草稿");
    expect(screen.getByAltText("保留的本地草稿品牌标识")).toHaveAttribute(
      "src",
      "https://signed.example/draft",
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:raw-logo");
  });

  it("restores the previous draft image and storage path when the server rejects an upload", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ code: "BRAND_LOGO_INVALID_CONTENT" }, 422),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          draft: ownerStudio.draft,
        }),
      );
    renderOwner();

    fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
      target: {
        files: [new File(["logo"], "new-logo.png", { type: "image/png" })],
      },
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "图片内容无效或像素尺寸过大",
      ),
    );
    expect(screen.getByAltText("星耀经营舱草稿品牌标识")).toHaveAttribute(
      "src",
      "https://signed.example/draft",
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:prepared-logo");

    fireEvent.change(screen.getByLabelText("品牌名称"), {
      target: { value: "仍使用原图" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      logoStoragePath: published.logoStoragePath,
    });
  });

  it.each([
    {
      name: "invalid format",
      file: () => new File(["svg"], "logo.svg", { type: "image/svg+xml" }),
      message: "仅支持 JPEG、PNG 或 WebP 图片。",
    },
    {
      name: "oversized bytes",
      file: () =>
        new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo.png", {
          type: "image/png",
        }),
      message: "LOGO 图片不能超过 2 MB。",
    },
  ])(
    "rejects $name before making an upload request",
    async ({ file, message }) => {
      const fetchMock = vi.mocked(fetch);
      renderOwner();

      fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
        target: { files: [file()] },
      });

      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(message),
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByAltText("星耀经营舱草稿品牌标识")).toHaveAttribute(
        "src",
        "https://signed.example/draft",
      );
    },
  );

  it("reports excessive source pixels safely and closes the decoded bitmap", async () => {
    const close = vi.fn();
    vi.mocked(createImageBitmap).mockResolvedValueOnce({
      width: 5000,
      height: 5000,
      close,
    } as never);
    renderOwner();

    fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
      target: {
        files: [new File(["logo"], "large.png", { type: "image/png" })],
      },
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "图片内容无效或像素尺寸过大",
      ),
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps unavailable upload codes without exposing raw server diagnostics", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          code: "ORGANIZATION_BRAND_LOGO_UNAVAILABLE",
          error: "raw bucket diagnostics",
        },
        503,
      ),
    );
    renderOwner();

    fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
      target: {
        files: [new File(["logo"], "logo.png", { type: "image/png" })],
      },
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "LOGO 服务暂时不可用，请稍后重试。",
      ),
    );
    expect(document.body).not.toHaveTextContent("raw bucket diagnostics");
  });

  it("saves the five governed fields and publishes only after the exact inline confirmation", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          draft: {
            ...ownerStudio.draft,
            content: {
              ...ownerStudio.draft!.content,
              brandName: "已保存草稿",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          version: 4,
          published: {
            ...published,
            version: 4,
            brandName: "已保存草稿",
            publishedAt: "2026-08-02T08:00:00.000Z",
          },
        }),
      );
    renderOwner();

    fireEvent.change(screen.getByLabelText("品牌名称"), {
      target: { value: "已保存草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(await screen.findByText("草稿已保存，尚未发布。")).toBeVisible();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      expectedVersion: 3,
      logoText: "星耀",
      logoStoragePath: published.logoStoragePath,
      brandName: "已保存草稿",
      brandTagline: "待发布的专业直播服务",
      primaryColor: "#1E50C8",
    });

    fireEvent.click(screen.getByRole("button", { name: "准备发布" }));
    expect(
      screen.getByText("只影响新页面刷新和新分享，已有分享保留原快照"),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认发布草稿" }));

    expect(await screen.findByText("品牌已发布为 v4。")).toBeVisible();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/organization/brand/publish");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      expectedVersion: 3,
    });
    expect(screen.getByText("当前线上版本 v4")).toBeVisible();
    expect(screen.getByText(/发布者 你/)).toBeVisible();
    expect(screen.getByLabelText("品牌名称")).toHaveValue("已保存草稿");
    const history = screen.getByText("发布历史").closest("details")!;
    fireEvent.click(within(history).getByText("发布历史"));
    expect(within(history).getByText("v4")).toBeVisible();
    expect(within(history).getByText(/你/)).toBeVisible();
  });

  it("does not invent a publisher label for an unpublished legacy organization", () => {
    renderOwner({
      initialStudio: {
        ...ownerStudio,
        published: { ...published, version: 0, publishedAt: null },
        versions: [],
      },
    });

    expect(screen.getByText("尚未发布")).toBeVisible();
    expect(screen.queryByText(/历史发布记录/)).not.toBeInTheDocument();
    expect(screen.queryByText("发布历史")).not.toBeInTheDocument();
  });

  it("keeps edits made after a deferred save started instead of applying the stale response", async () => {
    const saveResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(saveResponse.promise);
    renderOwner();

    fireEvent.change(screen.getByLabelText("品牌名称"), {
      target: { value: "请求快照" },
    });
    const saveButton = screen.getByRole("button", { name: "保存草稿" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("品牌名称"), {
      target: { value: "请求后的本地修改" },
    });
    saveResponse.resolve(
      jsonResponse({
        draft: {
          ...ownerStudio.draft,
          content: {
            ...ownerStudio.draft!.content,
            brandName: "请求快照",
          },
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "旧快照已保存，本地仍有待保存修改",
      ),
    );
    expect(screen.getByLabelText("品牌名称")).toHaveValue("请求后的本地修改");
    expect(screen.getByText("待保存")).toBeVisible();
  });

  it("updates the online version but preserves defensive local edits made before a deferred publish returns", async () => {
    const publishResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(publishResponse.promise);
    renderOwner();

    fireEvent.click(screen.getByRole("button", { name: "准备发布" }));
    fireEvent.click(screen.getByRole("button", { name: "确认发布草稿" }));
    fireEvent.change(screen.getByLabelText("品牌副标"), {
      target: { value: "发布请求后的防御性修改" },
    });
    publishResponse.resolve(
      jsonResponse({
        version: 4,
        published: {
          ...published,
          version: 4,
          brandName: ownerStudio.draft!.content.brandName,
          brandTagline: ownerStudio.draft!.content.brandTagline,
          primaryColor: ownerStudio.draft!.content.primaryColor,
          publishedAt: "2026-08-02T08:00:00.000Z",
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "品牌已发布为 v4；本地仍有待保存修改",
      ),
    );
    expect(screen.getByText("当前线上版本 v4")).toBeVisible();
    expect(screen.getByLabelText("品牌副标")).toHaveValue(
      "发布请求后的防御性修改",
    );
    expect(screen.getByText(/基于线上 v4/)).toBeVisible();
    expect(screen.getByText("待保存")).toBeVisible();
  });

  it("blocks save and publish synchronously while a deferred logo upload is pending", async () => {
    const uploadResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(uploadResponse.promise);
    renderOwner();

    fireEvent.click(screen.getByRole("button", { name: "准备发布" }));
    fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
      target: {
        files: [new File(["logo"], "pending.png", { type: "image/png" })],
      },
    });

    expect(
      screen.queryByRole("button", { name: "确认发布草稿" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "准备发布" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "准备发布" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "/api/organization/brand/logo",
    );

    uploadResponse.resolve(
      jsonResponse({
        logoStoragePath:
          "11111111-1111-4111-8111-111111111111/brand-logos/pending.webp",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("上传完成，待保存"),
    );
    expect(screen.getByText("待保存")).toBeVisible();
  });

  it("ignores a cancelled preparation that resolves after a replacement upload", async () => {
    const firstBitmap = deferred<ImageBitmap>();
    const secondBitmap = deferred<ImageBitmap>();
    vi.mocked(createImageBitmap)
      .mockReturnValueOnce(firstBitmap.promise)
      .mockReturnValueOnce(secondBitmap.promise);
    vi.mocked(URL.createObjectURL)
      .mockReset()
      .mockReturnValueOnce("blob:first-raw")
      .mockReturnValueOnce("blob:second-raw")
      .mockReturnValueOnce("blob:second-prepared");
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        logoStoragePath:
          "11111111-1111-4111-8111-111111111111/brand-logos/second.webp",
      }),
    );
    renderOwner();

    fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
      target: {
        files: [new File(["first"], "first.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消上传" }));
    fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
      target: {
        files: [new File(["second"], "second.png", { type: "image/png" })],
      },
    });

    firstBitmap.resolve({ width: 400, height: 400, close: vi.fn() } as never);
    secondBitmap.resolve({ width: 800, height: 600, close: vi.fn() } as never);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("上传完成，待保存"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const uploaded = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect((uploaded.get("logo") as File).name).toBe("second.webp");
    expect(screen.getByAltText("星耀经营舱草稿品牌标识")).toHaveAttribute(
      "src",
      "blob:second-prepared",
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first-raw");
  });

  it("promotes a successfully uploaded draft logo into the current online summary only after publish", async () => {
    const nextPath =
      "11111111-1111-4111-8111-111111111111/brand-logos/77777777-7777-4777-8777-777777777777.webp";
    const nextContent = {
      ...ownerStudio.draft!.content,
      logoStoragePath: nextPath,
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({ logoStoragePath: nextPath, contentType: "image/webp" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          draft: { ...ownerStudio.draft, content: nextContent },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          version: 4,
          published: {
            ...published,
            version: 4,
            logoStoragePath: nextPath,
            publishedAt: "2026-08-02T08:00:00.000Z",
          },
        }),
      );
    renderOwner();
    const onlineSection = screen
      .getByRole("heading", { name: "当前线上版本" })
      .closest("section")!;

    fireEvent.change(screen.getByLabelText("上传 LOGO 图片"), {
      target: {
        files: [new File(["logo"], "new.png", { type: "image/png" })],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("上传完成，待保存"),
    );
    expect(within(onlineSection).getByRole("img")).toHaveAttribute(
      "src",
      "https://signed.example/published",
    );
    expect(screen.getByAltText("星耀经营舱草稿品牌标识")).toHaveAttribute(
      "src",
      "blob:prepared-logo",
    );

    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("草稿已保存"),
    );
    fireEvent.click(screen.getByRole("button", { name: "准备发布" }));
    fireEvent.click(screen.getByRole("button", { name: "确认发布草稿" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("品牌已发布为 v4"),
    );
    expect(within(onlineSection).getByRole("img")).toHaveAttribute(
      "src",
      "blob:prepared-logo",
    );
    expect(screen.getByText(/发布者 你/)).toBeVisible();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:prepared-logo");
  });

  it("keeps the online logo until a saved logo removal is published", async () => {
    const withoutLogo = {
      ...ownerStudio.draft!.content,
      logoStoragePath: null,
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          draft: { ...ownerStudio.draft, content: withoutLogo },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          version: 4,
          published: {
            ...published,
            version: 4,
            logoStoragePath: null,
            publishedAt: "2026-08-02T08:00:00.000Z",
          },
        }),
      );
    renderOwner();
    const onlineSection = screen
      .getByRole("heading", { name: "当前线上版本" })
      .closest("section")!;

    fireEvent.click(screen.getByRole("button", { name: "移除草稿 LOGO" }));

    expect(within(onlineSection).getByRole("img")).toHaveAttribute(
      "src",
      "https://signed.example/published",
    );
    expect(
      screen.queryByAltText("星耀经营舱草稿品牌标识"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)),
    ).toMatchObject({ logoStoragePath: null });
    fireEvent.click(screen.getByRole("button", { name: "准备发布" }));
    fireEvent.click(screen.getByRole("button", { name: "确认发布草稿" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("品牌已发布为 v4"),
    );
    expect(within(onlineSection).queryByRole("img")).not.toBeInTheDocument();
  });

  it("preserves the local draft on 409, shows field differences and requires explicit re-confirmation", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ code: "BRAND_VERSION_CONFLICT", latestVersion: 4 }, 409),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          studio: {
            ...ownerStudio,
            published: {
              ...published,
              version: 4,
              brandName: "线上负责人版本",
            },
            draft: {
              ...ownerStudio.draft,
              content: { ...ownerStudio.draft!.content, brandName: "他人草稿" },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          draft: {
            ...ownerStudio.draft,
            baseVersion: 4,
            content: {
              ...ownerStudio.draft!.content,
              brandName: "我的本地草稿",
            },
          },
        }),
      );
    renderOwner();

    fireEvent.change(screen.getByLabelText("品牌名称"), {
      target: { value: "我的本地草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    const conflictHeading = await screen.findByRole("heading", {
      name: "检测到线上新版本 v4",
    });
    const conflictPanel = conflictHeading.closest("section")!;
    expect(within(conflictPanel).getByText("品牌名称")).toBeVisible();
    expect(within(conflictPanel).getByText(/线上负责人版本/)).toBeVisible();
    expect(within(conflictPanel).getByText(/我的本地草稿/)).toBeVisible();
    expect(screen.getByLabelText("品牌名称")).toHaveValue("我的本地草稿");
    expect(screen.queryByDisplayValue("他人草稿")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "采用线上版本号并重新确认" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      expectedVersion: 4,
      brandName: "我的本地草稿",
    });
    const history = screen.getByText("发布历史").closest("details")!;
    fireEvent.click(within(history).getByText("发布历史"));
    expect(within(history).getByText("v4")).toBeVisible();
    expect(
      within(history).getAllByText(/其他组织负责人/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("requires a conflicted publish to be re-saved against the adopted online version", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ code: "BRAND_VERSION_CONFLICT", latestVersion: 4 }, 409),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          studio: {
            ...ownerStudio,
            published: { ...published, version: 4 },
          },
        }),
      );
    renderOwner();

    fireEvent.click(screen.getByRole("button", { name: "准备发布" }));
    fireEvent.click(screen.getByRole("button", { name: "确认发布草稿" }));
    const adopt = await screen.findByRole("button", {
      name: "采用线上版本号并重新确认",
    });
    fireEvent.click(adopt);

    expect(screen.getByRole("button", { name: "准备发布" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "请重新保存并确认发布",
    );
  });

  it("toggles one normalized source between internal and public previews without leaking private metadata", () => {
    const { container } = renderOwner();

    expect(
      screen.getByRole("region", { name: "内部工作台预览" }),
    ).toHaveTextContent("星耀经营舱草稿");
    expect(
      screen.queryByRole("button", { name: "开始处理" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("开始处理")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "公开分享" }));
    const publicPreview = screen.getByRole("region", { name: "公开分享预览" });
    expect(publicPreview).toHaveTextContent("星耀经营舱草稿");
    expect(publicPreview).toHaveTextContent("录屏复核资料");
    expect(publicPreview).not.toHaveTextContent("v3");
    expect(publicPreview).not.toHaveTextContent("22222222-2222");
    expect(container).not.toHaveTextContent("logoStoragePath");
    expect(
      screen.queryByRole("button", { name: "开始复核" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("开始复核")).toBeVisible();
  });

  it("creates, updates, disables and emergency-removes governed contact cards", async () => {
    const fetchMock = vi.mocked(fetch);
    const created = {
      ...ownerStudio.contactCards[0],
      id: "66666666-6666-4666-8666-666666666666",
      displayName: "李商务",
      phone: "13900000000",
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ contactCard: created }, 201))
      .mockResolvedValueOnce(
        jsonResponse({
          contactCard: { ...ownerStudio.contactCards[0], title: "商务总监" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          contactCard: {
            ...ownerStudio.contactCards[0],
            status: "disabled",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ affectedActiveShareCount: 2 }));
    renderOwner();

    fireEvent.click(screen.getByText("新建联系名片"));
    fireEvent.change(screen.getByLabelText("新名片姓名"), {
      target: { value: "李商务" },
    });
    fireEvent.change(screen.getByLabelText("新名片电话"), {
      target: { value: "13900000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建联系名片" }));
    expect(await screen.findByText("联系名片已创建。")).toBeVisible();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      displayName: "李商务",
      title: "",
      phone: "13900000000",
      email: null,
      wechat: null,
    });

    fireEvent.click(screen.getByText("编辑 王负责人"));
    fireEvent.change(screen.getByLabelText("王负责人职务"), {
      target: { value: "商务总监" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存王负责人名片" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      displayName: "王负责人",
      title: "商务总监",
    });

    fireEvent.click(screen.getByRole("button", { name: "停用王负责人" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      status: "disabled",
    });

    const wangCard = screen.getAllByText("王负责人")[0].closest("article")!;
    fireEvent.click(within(wangCard).getByText("紧急移除"));
    fireEvent.change(within(wangCard).getByLabelText("紧急移除原因"), {
      target: { value: "联系人信息需要立即撤回" },
    });
    fireEvent.click(
      within(wangCard).getByLabelText("我理解该操作会影响所有有效分享"),
    );
    fireEvent.click(
      within(wangCard).getByRole("button", {
        name: "确认从所有有效分享中紧急移除",
      }),
    );
    expect(await screen.findByText("已从 2 个有效分享中移除。")).toBeVisible();
    expect(fetchMock.mock.calls[3][0]).toContain("/emergency-remove");
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      reason: "联系人信息需要立即撤回",
    });
  });

  it("keeps an unsaved card form edit when a status response returns old profile fields", async () => {
    const toggleResponse = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(toggleResponse.promise);
    renderOwner();

    fireEvent.click(screen.getByText("编辑 王负责人"));
    fireEvent.change(screen.getByLabelText("王负责人职务"), {
      target: { value: "尚未保存的新职务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "停用王负责人" }));
    toggleResponse.resolve(
      jsonResponse({
        contactCard: {
          ...ownerStudio.contactCards[0],
          title: "商务负责人",
          status: "disabled",
        },
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "启用王负责人" }),
      ).toBeVisible(),
    );
    expect(screen.getByLabelText("王负责人职务")).toHaveValue(
      "尚未保存的新职务",
    );
  });

  it("allows different cards to finish mutations out of order without clearing each other", async () => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    renderOwner();

    fireEvent.click(screen.getByRole("button", { name: "停用王负责人" }));
    fireEvent.click(screen.getByRole("button", { name: "启用旧联系人" }));
    expect(fetch).toHaveBeenCalledTimes(2);

    secondResponse.resolve(
      jsonResponse({
        contactCard: { ...ownerStudio.contactCards[1], status: "active" },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "停用旧联系人" }),
      ).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "停用王负责人" })).toBeDisabled();

    firstResponse.resolve(
      jsonResponse({
        contactCard: { ...ownerStudio.contactCards[0], status: "disabled" },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "启用王负责人" }),
      ).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: "停用旧联系人" })).toBeEnabled();
  });

  it("keeps retryable local state and announces asynchronous failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ error: "temporary" }, 503),
    );
    renderOwner();
    fireEvent.change(screen.getByLabelText("品牌名称"), {
      target: { value: "失败后仍保留" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("草稿保存失败，请重试。");
    expect(screen.getByLabelText("品牌名称")).toHaveValue("失败后仍保留");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
  });
});

describe("OrganizationBrandMark", () => {
  it("hides a broken image and falls back to logo text", () => {
    render(
      <OrganizationBrandMark
        brandName="星耀品牌"
        logoText="星"
        logoUrl="https://signed.example/broken"
      />,
    );

    const image = screen.getByAltText("星耀品牌品牌标识");
    fireEvent.error(image);
    expect(image).not.toBeInTheDocument();
    expect(screen.getByText("星")).toBeVisible();
  });

  it("uses at most four Unicode code points from the brand name as a defensive fallback", () => {
    render(
      <OrganizationBrandMark
        brandName="星耀专业品牌中心"
        logoText=""
        logoUrl={null}
      />,
    );
    expect(screen.getByText("星耀专业")).toBeVisible();
    expect(screen.queryByText("星耀专业品")).not.toBeInTheDocument();
  });
});
