import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdmissionSharePageClient from "./admission-share-page-client";

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
        reviewerName: "Vendor Reviewer",
        reviewerContact: "reviewer@example.com",
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
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("unlocks with a JSON-body code and then loads using the capability cookie", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    let boardRequests = 0;
    fetchMock.mockImplementation((async (url, init) => {
      if (
        String(url) === "/api/public/admission-share/plain-token" &&
        init?.method === "GET"
      ) {
        boardRequests += 1;
        return boardRequests === 1
          ? {
              ok: false,
              json: async () => ({ error: "Access code is required" }),
            }
          : {
              ok: true,
              json: async () => ({ shareBoard }),
            };
      }
      if (
        String(url) === "/api/public/admission-share/plain-token/unlock" &&
        init?.method === "POST"
      ) {
        return { ok: true, json: async () => ({ unlocked: true }) };
      }
      return {
        ok: false,
        json: async () => ({ error: "unexpected request" }),
      };
    }) as typeof fetch);

    render(<AdmissionSharePageClient token="plain-token" />);

    fireEvent.change(await screen.findByLabelText("访问码"), {
      target: { value: "2468" },
    });
    fireEvent.click(screen.getByRole("button", { name: "解锁复核链接" }));

    expect(await screen.findByText("Alpha Project")).toBeInTheDocument();
    const unlockCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/unlock") && init?.method === "POST",
    );
    expect(JSON.parse(String(unlockCall?.[1]?.body))).toEqual({
      accessCode: "2468",
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("accessCode")),
    ).toBe(false);
  });

  it("strips a legacy accessCode query without using it", async () => {
    window.history.replaceState(
      {},
      "",
      "/share/admission/plain-token?accessCode=legacy-secret&source=email",
    );
    const fetchMock = vi.mocked(globalThis.fetch);

    render(<AdmissionSharePageClient token="plain-token" />);

    expect(await screen.findByText("Alpha Project")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe("?source=email"));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("legacy-secret");
  });

  it("loads the public share board without rendering token hashes or storage paths", async () => {
    const { container } = render(
      <AdmissionSharePageClient token="plain-token" />,
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
  });

  it("renders professional delivery copy and switches recording players by source type", async () => {
    render(<AdmissionSharePageClient token="plain-token" />);

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
  });

  it("submits reviewer decisions with locked recording versions", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    render(<AdmissionSharePageClient token="plain-token" />);

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
      reviewerName: "",
      reviewerContact: "",
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
    render(<AdmissionSharePageClient token="plain-token" />);

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
});
