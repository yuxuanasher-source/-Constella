import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OrganizationBrandCenter,
  type OrganizationBrandCenterProps,
} from "./brand-center";
import { OrganizationBrandMark } from "./organization-brand-mark";

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
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:local-logo"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows owner governance controls, current publication and a clearly unpublished preview", () => {
    renderOwner();

    expect(screen.getByRole("heading", { name: "品牌中心" })).toBeVisible();
    expect(screen.getByText("当前线上版本 v3")).toBeVisible();
    expect(screen.getAllByText(/发布于/).length).toBeGreaterThan(0);
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
    expect(
      screen.queryByRole("button", { name: "保存草稿" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("联系名片管理")).not.toBeInTheDocument();
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
      "blob:local-logo",
    );
    expect(screen.getByText("当前线上版本 v3")).toBeVisible();
    expect(screen.queryByText("品牌已发布")).not.toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe("/api/organization/brand/logo");
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.body).toBeInstanceOf(FormData);
    expect(Array.from((init?.body as FormData).keys())).toEqual(["logo"]);
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
    expect(screen.getByLabelText("品牌名称")).toHaveValue("已保存草稿");
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
    fireEvent.click(screen.getByRole("button", { name: "公开分享" }));
    const publicPreview = screen.getByRole("region", { name: "公开分享预览" });
    expect(publicPreview).toHaveTextContent("星耀经营舱草稿");
    expect(publicPreview).toHaveTextContent("录屏复核资料");
    expect(publicPreview).not.toHaveTextContent("v3");
    expect(publicPreview).not.toHaveTextContent("22222222-2222");
    expect(container).not.toHaveTextContent("logoStoragePath");
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
