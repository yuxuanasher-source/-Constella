import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdmissionShareReviewWorkspace,
  type AdmissionShareReviewWorkspaceProps,
} from "./admission-share-review-workspace";
import type {
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
});
