import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdmissionSharePageClient, {
  youtubeEmbedSource,
} from "./admission-share-page-client";

const shareBoard = {
  id: "share-1",
  title: "Vendor review",
  status: "active",
  expiresAt: "2026-06-14T00:00:00.000Z",
  allowVendorSubmit: true,
  project: {
    id: "project-1",
    code: "P-001",
    name: "Alpha Project",
    vendor: "Vendor A",
    product: "Game A",
  },
  items: [
    {
      applicationId: "app-1",
      applicationStatus: "recording_reviewing",
      recordingSubmissionId: "rec-1",
      recordingVersion: 2,
      recordingStatus: "reviewing",
      recordingUrl: "https://video.example/rec-1.mp4",
      playbackUrl: "https://video.example/rec-1.mp4",
      hasPrivateStorage: false,
      streamer: {
        id: "streamer-1",
        displayName: "Streamer One",
        accountLabel: "Douyin / one-live",
      },
      vendorReview: null,
    },
    {
      applicationId: "app-2",
      applicationStatus: "recording_reviewing",
      recordingSubmissionId: "rec-2",
      recordingVersion: 1,
      recordingStatus: "approved",
      recordingUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      playbackUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      hasPrivateStorage: false,
      streamer: {
        id: "streamer-2",
        displayName: "Streamer Two",
        accountLabel: "Bilibili / two-live",
      },
      vendorReview: null,
    },
    {
      applicationId: "app-3",
      applicationStatus: "joined",
      recordingSubmissionId: "rec-3",
      recordingVersion: 1,
      recordingStatus: "approved",
      recordingUrl: null,
      playbackUrl: "/api/public/admission-share/plain-token/recordings/rec-3",
      hasPrivateStorage: true,
      streamer: {
        id: "streamer-3",
        displayName: "Streamer Three",
        accountLabel: "Kuaishou / three-live",
      },
      vendorReview: {
        decision: "backup",
        remark: "Can be backup.",
        submittedAt: "2026-06-07T04:00:00.000Z",
      },
    },
  ],
};

describe("AdmissionSharePageClient", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (
          String(url) === "/api/public/admission-share/plain-token/access" &&
          init?.method === "POST"
        ) {
          return {
            ok: true,
            json: async () => ({ authenticated: true }),
          };
        }

        if (
          String(url) === "/api/public/admission-share/plain-token" &&
          init?.method === "GET"
        ) {
          return {
            ok: true,
            json: async () => ({ shareBoard }),
          };
        }

        if (
          String(url) === "/api/public/admission-share/plain-token/reviews" &&
          init?.method === "POST"
        ) {
          return {
            ok: true,
            json: async () => ({
              submittedCount: 2,
              syncedCount: 1,
              skippedCount: 1,
            }),
          };
        }

        return {
          ok: false,
          json: async () => ({ error: "unexpected request" }),
        };
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads the public share board without rendering token hashes or storage paths", async () => {
    const { container } = render(
      <AdmissionSharePageClient token="plain-token" initialAccessCode="2468" />,
    );

    expect(await screen.findByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Vendor A / Game A")).toBeInTheDocument();
    expect(screen.getByText("Streamer One")).toBeInTheDocument();
    expect(screen.getByText("Douyin / one-live")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "打开 Streamer One 原始链接" }),
    ).toHaveAttribute("href", "https://video.example/rec-1.mp4");
    expect(screen.getByText("Can be backup.")).toBeInTheDocument();
    expect(screen.queryByLabelText("访问码")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("复核人姓名")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("联系方式")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("tokenHash");
    expect(container.textContent).not.toContain("storagePath");
    expect(container.textContent).not.toContain("private/path");
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining("accessCode="),
      expect.anything(),
    );
  });

  it("renders professional delivery copy and switches recording players by source type", async () => {
    render(
      <AdmissionSharePageClient token="plain-token" initialAccessCode="2468" />,
    );

    expect(await screen.findByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("录屏交付复核包")).toBeInTheDocument();
    expect(screen.getByText("甲方验收视图")).toBeInTheDocument();

    expect(
      screen.getByLabelText("Streamer One 原始录屏播放器"),
    ).toHaveAttribute("src", "https://video.example/rec-1.mp4");
    expect(screen.getByTitle("Streamer Two 平台录屏播放器")).toHaveAttribute(
      "src",
      expect.stringContaining("player.bilibili.com/player.html"),
    );
    expect(
      screen.getByLabelText("Streamer Three 原始录屏播放器"),
    ).toHaveAttribute(
      "src",
      "/api/public/admission-share/plain-token/recordings/rec-3",
    );
    expect(screen.getAllByText("备选").length).toBeGreaterThan(0);
    expect(screen.getByText("已判断 1 / 3")).toBeInTheDocument();
  });

  it("submits reviewer decisions with locked recording versions", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    render(
      <AdmissionSharePageClient token="plain-token" initialAccessCode="2468" />,
    );

    await screen.findByText("Alpha Project");
    fireEvent.change(screen.getByLabelText("Streamer One 决策"), {
      target: { value: "selected" },
    });
    fireEvent.change(screen.getByLabelText("Streamer One 备注"), {
      target: { value: "Good fit." },
    });

    fireEvent.click(screen.getByRole("button", { name: "提交复核" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/public/admission-share/plain-token/reviews",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const submitCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/reviews") && init?.method === "POST",
    );
    expect(JSON.parse(String(submitCall?.[1]?.body))).toEqual({
      items: [
        {
          recordingSubmissionId: "rec-1",
          recordingVersion: 2,
          decision: "selected",
          remark: "Good fit.",
          reasonCodes: [],
        },
        {
          recordingSubmissionId: "rec-2",
          recordingVersion: 1,
          decision: "pending",
          remark: "",
          reasonCodes: [],
        },
        {
          recordingSubmissionId: "rec-3",
          recordingVersion: 1,
          decision: "backup",
          remark: "Can be backup.",
          reasonCodes: [],
        },
      ],
    });
    expect(
      await screen.findByText("提交成功：2 条反馈，1 条已同步，1 条仅记录"),
    ).toBeInTheDocument();
  });

  it("requires remarks before submitting vendor rejection decisions", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    render(
      <AdmissionSharePageClient token="plain-token" initialAccessCode="2468" />,
    );

    await screen.findByText("Alpha Project");
    fireEvent.change(screen.getByLabelText("Streamer One 决策"), {
      target: { value: "rejected" },
    });

    fireEvent.click(screen.getByRole("button", { name: "提交复核" }));

    expect(
      await screen.findByText("拒绝或需修改时请填写原因"),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/reviews") && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("exchanges a legacy URL access code for a cookie before loading", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(
      <AdmissionSharePageClient token="plain-token" initialAccessCode="2468" />,
    );

    expect(await screen.findByText("Alpha Project")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/public/admission-share/plain-token/access",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accessCode: "2468" }),
      }),
    );
    expect(replaceState).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/share/admission/plain-token",
    );
  });

  it("prompts for an access code and retries after authentication", async () => {
    let authenticated = false;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith("/access") && init?.method === "POST") {
        authenticated = true;
        return {
          ok: true,
          json: async () => ({ authenticated: true }),
        } as Response;
      }
      if (
        String(url) === "/api/public/admission-share/plain-token" &&
        init?.method === "GET"
      ) {
        return {
          ok: authenticated,
          status: authenticated ? 200 : 401,
          json: async () =>
            authenticated
              ? { shareBoard }
              : {
                  code: "ACCESS_CODE_REQUIRED",
                  error: "请输入访问码后继续。",
                },
        } as Response;
      }
      throw new Error("unexpected request");
    });

    render(<AdmissionSharePageClient token="plain-token" />);

    fireEvent.change(await screen.findByLabelText("访问码"), {
      target: { value: "246810" },
    });
    fireEvent.click(screen.getByRole("button", { name: "验证访问码" }));

    expect(await screen.findByText("Alpha Project")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/public/admission-share/plain-token/access",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accessCode: "246810" }),
      }),
    );
  });

  it("offers a retry action for transient load failures", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          code: "SHARE_SERVICE_UNAVAILABLE",
          error: "分享服务暂时不可用，请稍后重试。",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ shareBoard }),
      } as Response);

    render(<AdmissionSharePageClient token="plain-token" />);

    expect(
      await screen.findByRole("alert", {
        name: "分享服务暂时不可用，请稍后重试。",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("Alpha Project")).toBeInTheDocument();
  });

  it("shows an actionable fallback when native video playback fails", async () => {
    render(
      <AdmissionSharePageClient token="plain-token" initialAccessCode="2468" />,
    );

    const player = await screen.findByLabelText("Streamer One 原始录屏播放器");
    fireEvent.error(player);

    expect(screen.getByText("视频加载失败")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "打开 Streamer One 原始链接" }),
    ).toHaveAttribute("href", "https://video.example/rec-1.mp4");
  });
});

describe("youtubeEmbedSource", () => {
  it.each([
    ["https://youtu.be/abc123", "https://www.youtube.com/embed/abc123"],
    [
      "https://www.youtube.com/shorts/short123",
      "https://www.youtube.com/embed/short123",
    ],
    [
      "https://www.youtube.com/live/live123",
      "https://www.youtube.com/embed/live123",
    ],
    [
      "https://www.youtube.com/embed/embed123",
      "https://www.youtube.com/embed/embed123",
    ],
  ])("normalizes %s", (source, expected) => {
    expect(youtubeEmbedSource(source)).toBe(expected);
  });
});
