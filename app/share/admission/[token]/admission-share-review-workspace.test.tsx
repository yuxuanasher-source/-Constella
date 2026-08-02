import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { relativeContrast } from "@/features/organizations/organization-brand";

import {
  AdmissionShareReviewWorkspace,
  type AdmissionShareReviewWorkspaceProps,
} from "./admission-share-review-workspace";
import type {
  BrandedPublicAdmissionShareBoard,
  PublicAdmissionShareBoard,
  ReviewDraft,
} from "./admission-share-types";

const formalBoard = {
  id: "share-1",
  title: "第一轮正式复核",
  purpose: "品牌方首轮选人",
  mode: "formal_review",
  status: "active",
  reviewState: "in_progress",
  roundNumber: 1,
  expiresAt: "2026-08-06T00:00:00.000Z",
  canSubmit: true,
  allowExternalFallback: true,
  progress: { completed: 1, total: 2 },
  latestSubmission: null,
  project: {
    id: "project-1",
    code: "P-001",
    name: "Alpha Project",
    vendor: "品牌甲方",
    product: "产品 A",
  },
  items: [
    {
      applicationId: "app-1",
      recordingSubmissionId: "recording-1",
      recordingVersion: 1,
      playbackUrl: "/api/public/admission-share/token/recordings/recording-1",
      externalUrl: null,
      sourceHealth: "original_ready",
      hasPrivateStorage: true,
      streamer: {
        id: "streamer-1",
        displayName: "待判断主播",
        accountLabel: "dy_1",
      },
      finalReview: null,
    },
    {
      applicationId: "app-2",
      recordingSubmissionId: "recording-2",
      recordingVersion: 1,
      playbackUrl: "/api/public/admission-share/token/recordings/recording-2",
      externalUrl: "https://video.example/2",
      sourceHealth: "external_only",
      hasPrivateStorage: false,
      streamer: {
        id: "streamer-2",
        displayName: "已完成主播",
        accountLabel: "dy_2",
      },
      finalReview: null,
    },
  ],
} satisfies PublicAdmissionShareBoard;

const brandedFormalBoard = {
  ...formalBoard,
  brand: {
    version: 4,
    logoText: "STAR",
    logoUrl: "/api/public/admission-share/public-token/brand-logo",
    brandName: "Star Live",
    brandTagline: "Professional live operations",
    primaryColor: "#165DFF",
  },
  contactCard: null,
} satisfies BrandedPublicAdmissionShareBoard;

const drafts = {
  "recording-1": {
    decision: "pending",
    remark: "",
    reasonCodes: [],
    revision: 0,
    updatedAt: null,
  },
  "recording-2": {
    decision: "backup",
    remark: "",
    reasonCodes: [],
    revision: 2,
    updatedAt: "2026-07-30T08:00:00.000Z",
  },
} satisfies Record<string, ReviewDraft>;

describe("AdmissionShareReviewWorkspace", () => {
  const onDraftChange = vi.fn();
  const onActiveRecordingChange = vi.fn();
  const onRetryDraft = vi.fn();
  const onOpenSubmissionSummary = vi.fn();
  const onReportPlaybackIssue = vi.fn();

  const formalProps = {
    board: formalBoard,
    drafts,
    saveState: { "recording-1": "idle", "recording-2": "saved" },
    activeRecordingId: "recording-1",
    onActiveRecordingChange,
    onDraftChange,
    onRetryDraft,
    onOpenSubmissionSummary,
    onReportPlaybackIssue,
    reasonOptions: [
      {
        key: "product_fit",
        label: "产品匹配",
        description: "产品呈现与要求不一致",
      },
    ],
  } satisfies AdmissionShareReviewWorkspaceProps;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a focused three-pane formal review and filters pending items", () => {
    render(<AdmissionShareReviewWorkspace {...formalProps} />);

    expect(
      screen.getByRole("navigation", { name: "录屏列表" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "录屏播放器" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("form", { name: "当前录屏判断" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "只看待判断" }));
    expect(screen.queryByText("已完成主播")).not.toBeInTheDocument();
  });

  it("emits typed decision, reason and remark patches without owning network state", () => {
    const { rerender } = render(
      <AdmissionShareReviewWorkspace {...formalProps} />,
    );

    fireEvent.click(screen.getByLabelText("需修改"));
    expect(onDraftChange).toHaveBeenCalledWith(
      "recording-1",
      expect.objectContaining({ decision: "needs_changes" }),
    );

    const negativeDrafts = {
      ...drafts,
      "recording-1": {
        ...drafts["recording-1"],
        decision: "needs_changes" as const,
      },
    };
    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        drafts={negativeDrafts}
      />,
    );
    fireEvent.click(screen.getByLabelText("产品匹配"));
    expect(onDraftChange).toHaveBeenCalledWith(
      "recording-1",
      expect.objectContaining({ reasonCodes: ["product_fit"] }),
    );
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "需要补充产品卖点" },
    });
    expect(onDraftChange).toHaveBeenCalledWith(
      "recording-1",
      expect.objectContaining({ remark: "需要补充产品卖点" }),
    );

    fireEvent.click(screen.getByLabelText("入选"));
    expect(onDraftChange).toHaveBeenLastCalledWith("recording-1", {
      decision: "selected",
      reasonCodes: [],
    });
  });

  it("requires every item and complete negative reasons before opening summary", () => {
    render(<AdmissionShareReviewWorkspace {...formalProps} />);

    expect(screen.getByRole("button", { name: "查看提交汇总" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("入选"));
    expect(onDraftChange).toHaveBeenCalledWith(
      "recording-1",
      expect.objectContaining({ decision: "selected" }),
    );
  });

  it("renders preview mode without drafts or decision controls", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{
          ...formalBoard,
          mode: "preview",
          canSubmit: false,
          reviewState: "viewed",
        }}
        drafts={{}}
      />,
    );

    expect(
      screen.queryByRole("form", { name: "当前录屏判断" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "查看提交汇总" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("当前录屏备注")).not.toBeInTheDocument();
  });

  it("uses the controlled active item and exposes keyboard-sized navigation", () => {
    render(<AdmissionShareReviewWorkspace {...formalProps} />);

    fireEvent.click(screen.getByRole("button", { name: /已完成主播/ }));
    expect(onActiveRecordingChange).toHaveBeenCalledWith("recording-2");
    expect(screen.getByRole("button", { name: "上一条" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一条" })).toBeEnabled();
  });

  it("derives progress from complete current drafts instead of stale board progress", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{ ...formalBoard, progress: { completed: 0, total: 99 } }}
      />,
    );

    expect(
      within(screen.getByRole("navigation", { name: "录屏列表" })).getByText(
        "1/2",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("0/99")).not.toBeInTheDocument();
  });

  it("announces save failures and lets the reviewer retry", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        saveState={{ ...formalProps.saveState, "recording-1": "failed" }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("保存失败");
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    expect(onRetryDraft).toHaveBeenCalledWith("recording-1");
  });

  it("plays a direct external video through the controlled public playback route", () => {
    const externalItem = {
      ...formalBoard.items[1],
      externalUrl: "https://video.example/recording-2.mp4",
    };
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{ ...formalBoard, items: [externalItem] }}
        activeRecordingId="recording-2"
      />,
    );

    expect(screen.getByLabelText("已完成主播 外部录屏播放器")).toHaveAttribute(
      "src",
      externalItem.playbackUrl,
    );
    expect(screen.getByRole("button", { name: "反馈播放问题" })).toBeEnabled();
  });

  it("keeps the legacy player mounted immediately when branded media is disabled", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={brandedFormalBoard}
        brandUiEnabled={false}
      />,
    );

    expect(
      screen.getByLabelText("待判断主播 原始录屏播放器"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "播放录屏" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "录屏播放器" })).toHaveClass(
      "bg-[var(--ink-900)]",
    );
  });

  it("shows a truthful branded poster before mounting the original video", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={brandedFormalBoard}
        brandUiEnabled
      />,
    );

    const stage = screen.getByRole("region", { name: "录屏媒体工作区" });
    expect(stage).toHaveAttribute("data-state", "idle");
    expect(
      screen.getByRole("region", { name: "待判断主播 录屏待播放" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Star Live · 组织官方分享")).toBeInTheDocument();
    expect(screen.getByText("Alpha Project · 第 1 轮")).toBeInTheDocument();
    expect(screen.queryByRole("video")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("待判断主播 原始录屏播放器"),
    ).not.toBeInTheDocument();
    const play = screen.getByRole("button", { name: "播放录屏" });
    expect(play.className).toMatch(/\bmin-h-11\b/);
    expect(document.body.textContent).not.toContain("认证");
  });

  it.each(["#FFFFFF", "#ADD8E6", "#FFFF00"])(
    "derives a WCAG AA action color instead of using the light seed %s",
    (primaryColor) => {
      render(
        <AdmissionShareReviewWorkspace
          {...formalProps}
          board={{
            ...brandedFormalBoard,
            brand: { ...brandedFormalBoard.brand, primaryColor },
          }}
          brandUiEnabled
        />,
      );

      const stage = screen.getByRole("region", { name: "录屏媒体工作区" });
      const actionColor = stage.style.getPropertyValue("--share-brand-action");
      expect(actionColor).toMatch(/^#[0-9A-F]{6}$/u);
      expect(actionColor).not.toBe(primaryColor);
      expect(relativeContrast(actionColor, "#FFFFFF")).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  it("keeps the poster through loading and reveals a portrait video at its reduced intrinsic ratio", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={brandedFormalBoard}
        brandUiEnabled
      />,
    );

    const playButton = screen.getByRole("button", { name: "播放录屏" });
    playButton.focus();
    fireEvent.click(playButton);

    const stage = screen.getByRole("region", { name: "录屏媒体工作区" });
    const video = screen.getByLabelText("待判断主播 原始录屏播放器");
    const canvas = stage.querySelector<HTMLElement>(".recording-media-canvas");
    expect(stage).toHaveAttribute("data-state", "loading");
    expect(
      screen.getByRole("status", { name: "录屏加载状态" }),
    ).toHaveTextContent("正在加载录屏");
    expect(
      screen.getByRole("region", { name: "待判断主播 录屏待播放" }),
    ).toBeInTheDocument();
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("tabindex", "-1");
    expect(video).toHaveAttribute("aria-hidden", "true");
    expect(video).toHaveAttribute("inert");
    expect(playButton).toHaveFocus();
    expect(playButton).toHaveAttribute("aria-disabled", "true");

    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1080,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 1920,
    });
    fireEvent.loadedMetadata(video);

    expect(canvas).toHaveAttribute("data-orientation", "portrait");
    expect(canvas?.style.getPropertyValue("--recording-aspect-ratio")).toBe(
      "9 / 16",
    );

    const focusVideo = vi.spyOn(video, "focus");
    fireEvent.canPlay(video);
    expect(stage).toHaveAttribute("data-state", "playing");
    expect(video).toHaveAttribute("tabindex", "0");
    expect(video).not.toHaveAttribute("aria-hidden");
    expect(video).not.toHaveAttribute("inert");
    expect(focusVideo).toHaveBeenCalledTimes(1);
    expect(video).toHaveFocus();
    fireEvent.playing(video);
    expect(focusVideo).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("region", { name: "待判断主播 录屏待播放" }),
    ).not.toBeInTheDocument();
  });

  it("does not steal focus when the reviewer leaves the loading poster", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={brandedFormalBoard}
        brandUiEnabled
      />,
    );

    const playButton = screen.getByRole("button", { name: "播放录屏" });
    playButton.focus();
    fireEvent.click(playButton);
    const video = screen.getByLabelText("待判断主播 原始录屏播放器");
    const focusVideo = vi.spyOn(video, "focus");
    const remark = screen.getByLabelText("当前录屏备注");
    remark.focus();

    fireEvent.canPlay(video);
    fireEvent.playing(video);

    expect(remark).toHaveFocus();
    expect(focusVideo).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "录屏媒体工作区" }),
    ).toHaveAttribute("data-state", "playing");
  });

  it("transfers focus to an external embed at most once", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{
          ...brandedFormalBoard,
          items: [
            {
              ...brandedFormalBoard.items[1],
              externalUrl: "https://www.youtube.com/watch?v=video-2",
            },
          ],
        }}
        activeRecordingId="recording-2"
        brandUiEnabled
      />,
    );

    const playButton = screen.getByRole("button", { name: "播放录屏" });
    playButton.focus();
    fireEvent.click(playButton);
    const embed = screen.getByTitle("外部平台录屏");
    const focusEmbed = vi.spyOn(embed, "focus");

    expect(embed).toHaveAttribute("tabindex", "-1");
    expect(embed).toHaveAttribute("aria-hidden", "true");
    expect(embed).toHaveAttribute("inert");

    fireEvent.load(embed);
    fireEvent.load(embed);

    expect(embed).toHaveAttribute("tabindex", "0");
    expect(embed).not.toHaveAttribute("aria-hidden");
    expect(embed).not.toHaveAttribute("inert");
    expect(focusEmbed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveFocus();
  });

  it("resets focus ownership for retry and ignores the stale media attempt", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={brandedFormalBoard}
        brandUiEnabled
      />,
    );

    const firstPlay = screen.getByRole("button", { name: "播放录屏" });
    firstPlay.focus();
    fireEvent.click(firstPlay);
    const firstVideo = screen.getByLabelText("待判断主播 原始录屏播放器");
    const focusFirstVideo = vi.spyOn(firstVideo, "focus");
    fireEvent.error(firstVideo);

    const retry = screen.getByRole("button", { name: "重试原始视频" });
    retry.focus();
    fireEvent.click(retry);
    const stage = screen.getByRole("region", { name: "录屏媒体工作区" });
    const secondVideo = screen.getByLabelText("待判断主播 原始录屏播放器");
    const focusSecondVideo = vi.spyOn(secondVideo, "focus");

    fireEvent.canPlay(firstVideo);
    expect(focusFirstVideo).not.toHaveBeenCalled();
    expect(stage).toHaveFocus();

    fireEvent.canPlay(secondVideo);
    expect(focusSecondVideo).toHaveBeenCalledTimes(1);
    expect(secondVideo).toHaveFocus();
  });

  it("resets media focus ownership when the active recording changes", () => {
    const switchableBoard = {
      ...brandedFormalBoard,
      items: [
        brandedFormalBoard.items[0],
        {
          ...brandedFormalBoard.items[1],
          externalUrl: "https://video.example/recording-2.mp4",
        },
      ],
    };
    const { rerender } = render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={switchableBoard}
        brandUiEnabled
      />,
    );

    const firstPlay = screen.getByRole("button", { name: "播放录屏" });
    firstPlay.focus();
    fireEvent.click(firstPlay);
    const firstVideo = screen.getByLabelText("待判断主播 原始录屏播放器");
    const focusFirstVideo = vi.spyOn(firstVideo, "focus");

    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={switchableBoard}
        activeRecordingId="recording-2"
        brandUiEnabled
      />,
    );
    const secondPlay = screen.getByRole("button", { name: "播放录屏" });
    secondPlay.focus();
    fireEvent.click(secondPlay);
    const secondVideo = screen.getByLabelText("已完成主播 外部录屏播放器");

    fireEvent.canPlay(firstVideo);
    expect(focusFirstVideo).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "录屏媒体工作区" }),
    ).toHaveAttribute("data-state", "loading");

    fireEvent.canPlay(secondVideo);
    expect(secondVideo).toHaveFocus();
    expect(
      screen.getByRole("region", { name: "录屏媒体工作区" }),
    ).toHaveAttribute("data-state", "playing");
  });

  it("falls back to 16:9 metadata without changing the active item or draft", () => {
    const preservedDrafts = {
      ...drafts,
      "recording-1": {
        ...drafts["recording-1"],
        remark: "这段草稿必须保留",
      },
    };
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={brandedFormalBoard}
        drafts={preservedDrafts}
        brandUiEnabled
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "播放录屏" }));
    const video = screen.getByLabelText("待判断主播 原始录屏播放器");
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: 1080,
    });
    fireEvent.loadedMetadata(video);

    const canvas = screen
      .getByRole("region", { name: "录屏媒体工作区" })
      .querySelector<HTMLElement>(".recording-media-canvas");
    expect(canvas).toHaveAttribute("data-orientation", "landscape");
    expect(canvas?.style.getPropertyValue("--recording-aspect-ratio")).toBe(
      "16 / 9",
    );

    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: Number.NaN,
    });
    fireEvent.loadedMetadata(video);
    expect(canvas).toHaveAttribute("data-orientation", "landscape");
    expect(canvas?.style.getPropertyValue("--recording-aspect-ratio")).toBe(
      "16 / 9",
    );
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue(
      "这段草稿必须保留",
    );
    expect(onActiveRecordingChange).not.toHaveBeenCalled();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("isolates original load errors while retaining context, draft and a secure fallback", () => {
    const preservedDrafts = {
      ...drafts,
      "recording-1": {
        ...drafts["recording-1"],
        remark: "未提交复核意见",
      },
    };
    const board = {
      ...brandedFormalBoard,
      items: [
        {
          ...brandedFormalBoard.items[0],
          sourceHealth: "original_with_external_fallback" as const,
          externalUrl: "https://video.example/recording-1.mp4",
        },
        brandedFormalBoard.items[1],
      ],
    };
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={board}
        drafts={preservedDrafts}
        brandUiEnabled
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "播放录屏" }));
    fireEvent.error(screen.getByLabelText("待判断主播 原始录屏播放器"));

    const playbackAlert = screen.getByRole("alert", { name: "录屏播放失败" });
    expect(playbackAlert).toHaveTextContent("视频加载失败");
    expect(
      screen.getByRole("region", { name: "录屏媒体工作区" }),
    ).toHaveAttribute("data-state", "error");
    expect(screen.getAllByText("待判断主播").length).toBeGreaterThan(0);
    expect(playbackAlert).toHaveTextContent("Alpha Project · 第 1 轮");
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue("未提交复核意见");
    expect(onActiveRecordingChange).not.toHaveBeenCalled();
    const fallback = screen.getByRole("link", { name: "打开备用视频" });
    expect(fallback).toHaveAttribute(
      "href",
      "https://video.example/recording-1.mp4",
    );
    expect(fallback).toHaveAttribute("rel", "noopener noreferrer");

    fireEvent.click(screen.getByRole("button", { name: "重试原始视频" }));
    expect(
      screen.getByRole("region", { name: "录屏媒体工作区" }),
    ).toHaveAttribute("data-state", "loading");
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue("未提交复核意见");
  });

  it("keeps full recording context in the unavailable state without leaking unsafe sources", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{
          ...brandedFormalBoard,
          items: [
            {
              ...brandedFormalBoard.items[0],
              playbackUrl: "",
              externalUrl: "javascript:alert(document.domain)",
              sourceHealth: "blocked",
              hasPrivateStorage: false,
            },
          ],
        }}
        brandUiEnabled
      />,
    );

    expect(
      screen.getByRole("region", { name: "录屏媒体工作区" }),
    ).toHaveAttribute("data-state", "unavailable");
    const unavailableAlert = screen.getByRole("alert", { name: "录屏不可用" });
    expect(unavailableAlert).toHaveTextContent("当前没有可播放来源");
    expect(screen.getAllByText("待判断主播").length).toBeGreaterThan(0);
    expect(unavailableAlert).toHaveTextContent("Alpha Project · 第 1 轮");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("javascript:");
  });

  it("shows a safe non-embeddable external source immediately without a fake play step", () => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{
          ...brandedFormalBoard,
          items: [
            {
              ...brandedFormalBoard.items[1],
              externalUrl: "https://video.example/recording-2",
            },
          ],
        }}
        activeRecordingId="recording-2"
        brandUiEnabled
      />,
    );

    expect(
      screen.getByRole("region", { name: "录屏媒体工作区" }),
    ).toHaveAttribute("data-state", "unavailable");
    expect(
      screen.queryByRole("button", { name: "播放录屏" }),
    ).not.toBeInTheDocument();
    const externalLink = screen.getByRole("link", { name: "打开外部录屏" });
    expect(externalLink).toHaveAttribute(
      "href",
      "https://video.example/recording-2",
    );
    expect(externalLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it.each([
    "javascript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "/relative/video.mp4",
  ])("does not render an unsafe external URL: %s", (externalUrl) => {
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{
          ...formalBoard,
          items: [{ ...formalBoard.items[1], externalUrl }],
        }}
        activeRecordingId="recording-2"
      />,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByTitle("外部平台录屏")).not.toBeInTheDocument();
  });

  it("embeds only exact Bilibili hosts or their subdomains", () => {
    const { rerender } = render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{
          ...formalBoard,
          items: [
            {
              ...formalBoard.items[1],
              externalUrl: "https://evilbilibili.com/video/BV1xx411c7mD",
            },
          ],
        }}
        activeRecordingId="recording-2"
      />,
    );

    expect(screen.queryByTitle("外部平台录屏")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开外部录屏" })).toHaveAttribute(
      "href",
      "https://evilbilibili.com/video/BV1xx411c7mD",
    );

    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{
          ...formalBoard,
          items: [
            {
              ...formalBoard.items[1],
              externalUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
            },
          ],
        }}
        activeRecordingId="recording-2"
      />,
    );
    expect(screen.getByTitle("外部平台录屏")).toHaveAttribute(
      "src",
      expect.stringContaining("player.bilibili.com"),
    );
  });

  it("keeps mobile navigation sticky outside clipping and honors safe area", () => {
    render(<AdmissionShareReviewWorkspace {...formalProps} />);

    const workspace = screen.getByRole("region", {
      name: "录屏复核工作台",
    });
    const navigation = screen.getByRole("button", {
      name: "下一条",
    }).parentElement;
    expect(workspace).not.toHaveClass("overflow-hidden");
    expect(navigation).toHaveClass("sticky", "bottom-0");
    expect(navigation?.className).toContain("safe-area-inset-bottom");
  });

  it("closes the mobile drawer through one focus-restoring path after selection", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    render(<AdmissionShareReviewWorkspace {...formalProps} />);
    const trigger = screen.getByRole("button", { name: "打开录屏列表" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "选择录屏" });
    expect(
      within(dialog).getByRole("button", { name: "关闭录屏列表" }).className,
    ).toMatch(/\b(?:h-11|min-h-11)\b/);

    fireEvent.click(within(dialog).getByRole("button", { name: /已完成主播/ }));

    expect(onActiveRecordingChange).toHaveBeenCalledWith("recording-2");
    expect(
      screen.queryByRole("dialog", { name: "选择录屏" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("uses at least 44px targets for critical mobile controls", () => {
    render(<AdmissionShareReviewWorkspace {...formalProps} />);

    for (const control of [
      screen.getByRole("button", { name: "只看待判断" }),
      screen.getByRole("button", { name: "打开录屏列表" }),
      screen.getByRole("button", { name: "反馈播放问题" }),
      screen.getByRole("button", { name: "上一条" }),
      screen.getByRole("button", { name: "下一条" }),
    ]) {
      expect(control.className).toMatch(/\b(?:min-h-11|min-h-14|h-11)\b/);
    }
  });

  it("uses at least 44px targets for retry and external-link actions", () => {
    const { rerender } = render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        saveState={{ ...formalProps.saveState, "recording-1": "failed" }}
      />,
    );
    expect(screen.getByRole("button", { name: "重试保存" }).className).toMatch(
      /\bmin-h-11\b/,
    );

    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        activeRecordingId="recording-2"
      />,
    );
    expect(
      screen.getByRole("link", { name: "打开外部录屏" }).className,
    ).toMatch(/\bmin-h-11\b/);
  });

  it("isolates a playback failure with retry, safe fallback and one per-recording report", async () => {
    const reportIssue = vi.fn().mockResolvedValue(true);
    const board = {
      ...formalBoard,
      items: [
        {
          ...formalBoard.items[0],
          externalUrl: "https://video.example/recording-1.mp4",
          sourceHealth: "original_with_external_fallback" as const,
        },
        formalBoard.items[1],
      ],
    };
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={board}
        onReportPlaybackIssue={reportIssue}
      />,
    );

    fireEvent.error(screen.getByLabelText("待判断主播 原始录屏播放器"));
    expect(
      screen.getByRole("button", { name: "重试原始视频" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开备用视频" })).toHaveAttribute(
      "href",
      "https://video.example/recording-1.mp4",
    );

    const reportButton = screen.getByRole("button", {
      name: "反馈无法播放",
    });
    expect(reportButton.className).toMatch(/\bmin-h-11\b/);
    fireEvent.click(reportButton);
    fireEvent.click(reportButton);

    await waitFor(() => expect(reportIssue).toHaveBeenCalledTimes(1));
    expect(reportIssue).toHaveBeenCalledWith("recording-1", "original");
    expect(
      await screen.findByRole("status", { name: "播放问题反馈状态" }),
    ).toHaveTextContent("已反馈");
    expect(reportButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    expect(onActiveRecordingChange).toHaveBeenCalledWith("recording-2");

    fireEvent.click(screen.getByRole("button", { name: "重试原始视频" }));
    expect(
      screen.getByLabelText("待判断主播 原始录屏播放器"),
    ).toBeInTheDocument();
  });

  it("releases the report lock after a rejected request and lets the reviewer retry", async () => {
    const reportIssue = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(true);
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        onReportPlaybackIssue={reportIssue}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    expect(
      await screen.findByRole("status", { name: "播放问题反馈状态" }),
    ).toHaveTextContent("反馈失败，可重试");

    fireEvent.click(screen.getByRole("button", { name: "重试反馈无法播放" }));
    await waitFor(() => expect(reportIssue).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("status", { name: "播放问题反馈状态" }),
    ).toHaveTextContent("已反馈");
  });

  it("drops a stale report completion after the share board changes", async () => {
    let finishFirstReport: (reported: boolean) => void = () => {};
    const reportIssue = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishFirstReport = resolve;
          }),
      )
      .mockResolvedValueOnce(true);
    const { rerender } = render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        onReportPlaybackIssue={reportIssue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));

    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{ ...formalBoard, id: "share-2" }}
        onReportPlaybackIssue={reportIssue}
      />,
    );
    await act(async () => finishFirstReport(true));

    const freshButton = await screen.findByRole("button", {
      name: "反馈播放问题",
    });
    expect(freshButton).toBeEnabled();
    fireEvent.click(freshButton);
    await waitFor(() => expect(reportIssue).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("status", { name: "播放问题反馈状态" }),
    ).toHaveTextContent("已反馈");
  });

  it("drops a stale report completion after the active recording changes", async () => {
    let finishReport: (reported: boolean) => void = () => {};
    const reportIssue = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishReport = resolve;
        }),
    );
    const { rerender } = render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        onReportPlaybackIssue={reportIssue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));

    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        activeRecordingId="recording-2"
        onReportPlaybackIssue={reportIssue}
      />,
    );
    await act(async () => finishReport(true));
    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        activeRecordingId="recording-1"
        onReportPlaybackIssue={reportIssue}
      />,
    );

    expect(screen.getByRole("button", { name: "反馈播放问题" })).toBeEnabled();
    expect(
      screen.queryByRole("status", { name: "播放问题反馈状态" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the newer report locked when an older same-board request rejects after an active-recording ABA switch", async () => {
    let rejectFirstReport: (reason?: unknown) => void = () => {};
    let finishSecondReport: (reported: boolean) => void = () => {};
    const reportIssue = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((_resolve, reject) => {
            rejectFirstReport = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishSecondReport = resolve;
          }),
      );
    const { rerender } = render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        onReportPlaybackIssue={reportIssue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));

    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        activeRecordingId="recording-2"
        onReportPlaybackIssue={reportIssue}
      />,
    );
    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        activeRecordingId="recording-1"
        onReportPlaybackIssue={reportIssue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    await waitFor(() => expect(reportIssue).toHaveBeenCalledTimes(2));

    await act(async () => rejectFirstReport(new Error("stale request")));

    const secondReportButton = screen.getByRole("button", { name: "反馈中…" });
    expect(secondReportButton).toBeDisabled();
    fireEvent.click(secondReportButton);
    expect(reportIssue).toHaveBeenCalledTimes(2);

    await act(async () => finishSecondReport(true));
  });

  it("keeps the newer board report locked when the previous board request completes", async () => {
    let finishFirstReport: (reported: boolean) => void = () => {};
    let finishSecondReport: (reported: boolean) => void = () => {};
    const reportIssue = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishFirstReport = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishSecondReport = resolve;
          }),
      );
    const { rerender } = render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        onReportPlaybackIssue={reportIssue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));

    rerender(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{ ...formalBoard, id: "share-2" }}
        onReportPlaybackIssue={reportIssue}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    await waitFor(() => expect(reportIssue).toHaveBeenCalledTimes(2));

    await act(async () => finishFirstReport(true));

    const secondReportButton = screen.getByRole("button", { name: "反馈中…" });
    expect(secondReportButton).toBeDisabled();
    expect(reportIssue).toHaveBeenCalledTimes(2);

    await act(async () => finishSecondReport(true));
    expect(
      await screen.findByRole("status", { name: "播放问题反馈状态" }),
    ).toHaveTextContent("已反馈");
  });

  it("uses external-source actions after an external-only video fails", () => {
    const externalItem = {
      ...formalBoard.items[1],
      externalUrl: "https://video.example/recording-2.mp4",
    };
    render(
      <AdmissionShareReviewWorkspace
        {...formalProps}
        board={{ ...formalBoard, items: [externalItem] }}
        activeRecordingId="recording-2"
      />,
    );

    fireEvent.error(screen.getByLabelText("已完成主播 外部录屏播放器"));
    expect(
      screen.getByRole("button", { name: "重试外部视频" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开外部视频" })).toHaveAttribute(
      "href",
      "https://video.example/recording-2.mp4",
    );
    expect(
      screen.queryByRole("button", { name: "重试原始视频" }),
    ).not.toBeInTheDocument();
  });
});
