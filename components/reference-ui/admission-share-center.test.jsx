import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdmissionShareCenter } from "./admission-share-center";

const historicalCandidate = {
  applicationId: "app-1",
  recordingSubmissionId: "recording-v1",
  recordingVersion: 1,
  isLatestVersion: false,
  streamer: {
    id: "streamer-1",
    displayName: "主播甲",
    accountLabel: "dy_1",
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

const latestCandidate = {
  ...historicalCandidate,
  recordingSubmissionId: "recording-v2",
  recordingVersion: 2,
  isLatestVersion: true,
  sourceHealth: "original_with_external_fallback",
  externalUrl: "https://video.example/app-1-v2",
};

const blockedCandidate = {
  applicationId: "app-2",
  recordingSubmissionId: "recording-blocked",
  recordingVersion: 2,
  isLatestVersion: true,
  streamer: {
    id: "streamer-2",
    displayName: "主播乙",
    accountLabel: "dy_2",
  },
  mcnReviewDecision: null,
  sourceHealth: "blocked",
  hasPrivateStorage: true,
  externalUrl: null,
  isShareable: false,
  blockReason: "MCN_APPROVAL_REQUIRED",
  currentVendorDecision: "pending",
  lastSharedAt: null,
};

const warningCandidate = {
  applicationId: "app-3",
  recordingSubmissionId: "recording-external",
  recordingVersion: 1,
  isLatestVersion: true,
  streamer: {
    id: "streamer-3",
    displayName: "主播丙",
    accountLabel: "ks_3",
  },
  mcnReviewDecision: "approved",
  sourceHealth: "external_only",
  hasPrivateStorage: false,
  externalUrl: "https://video.example/app-3",
  isShareable: true,
  blockReason: null,
  currentVendorDecision: "backup",
  lastSharedAt: "2026-07-29T08:00:00.000Z",
};

const candidates = [
  latestCandidate,
  historicalCandidate,
  blockedCandidate,
  warningCandidate,
];

const project = { id: "project-1", name: "Alpha Project" };

function readyResult(items) {
  return {
    summary: { ready: items.length, warning: 0, blocked: 0 },
    items: items.map((item) => ({
      ...item,
      status: "ready",
      sourceHealth: "original_ready",
      reasonCode: null,
    })),
  };
}

function createActions() {
  return {
    listAdmissionShareCandidates: vi.fn().mockResolvedValue(candidates),
    openAdmissionShareCandidatePlayback: vi.fn(),
    preflightAdmissionShareBoard: vi
      .fn()
      .mockImplementation((_projectId, items) =>
        Promise.resolve(readyResult(items)),
      ),
    listAdmissionShareBoards: vi.fn().mockResolvedValue([]),
    createAdmissionShareBoard: vi.fn().mockResolvedValue({
      shareBoard: { id: "share-1", mode: "formal_review" },
      shareUrl: "https://app.example/share/admission/plain-token",
      accessCode: "24681024",
    }),
    extendAdmissionShareBoard: vi.fn().mockResolvedValue({ ok: true }),
    reopenAdmissionShareBoard: vi.fn().mockResolvedValue({ ok: true }),
    rotateAdmissionShareBoardToken: vi.fn().mockResolvedValue({
      shareUrl: "https://app.example/share/admission/rotated-token",
    }),
    revokeAdmissionShareBoard: vi.fn().mockResolvedValue({ ok: true }),
    listAdmissionShareSubmissions: vi.fn().mockResolvedValue([]),
    listAdmissionSharePlaybackIssues: vi.fn().mockResolvedValue([]),
    resolveAdmissionSharePlaybackIssue: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function renderShareCenter(actions, onClose = vi.fn()) {
  return render(
    <AdmissionShareCenter
      project={project}
      actions={actions}
      onClose={onClose}
    />,
  );
}

describe("AdmissionShareCenter", () => {
  let actions;

  beforeEach(() => {
    actions = createActions();
  });

  it("selects an approved historical version and removes only blocked items", async () => {
    actions.preflightAdmissionShareBoard.mockResolvedValueOnce({
      summary: { ready: 1, warning: 0, blocked: 1 },
      items: [
        {
          ...historicalCandidate,
          sortOrder: 0,
          status: "ready",
          reasonCode: null,
        },
        {
          ...blockedCandidate,
          sortOrder: 1,
          status: "blocked",
          reasonCode: "MCN_APPROVAL_REQUIRED",
        },
      ],
    });
    renderShareCenter(actions);

    expect(
      await screen.findByRole("tab", { name: "录屏库" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "展开 主播甲 历史版本" }),
    );
    fireEvent.click(screen.getByLabelText("选择 主播甲 V1"));
    fireEvent.click(screen.getByLabelText("选择 主播乙 V2"));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));

    expect(await screen.findByText("1 条录屏无法分享")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog", { name: "创建录屏分享" })).getByText(
        "MCN 审核通过后才可分享",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除异常并继续" }));
    expect(screen.getByText("已选择 1 条")).toBeInTheDocument();
    expect(screen.getByLabelText("分享名称")).toHaveValue(
      "Alpha Project 录屏复核",
    );
    expect(screen.getByLabelText("选择 主播乙 V2")).not.toBeChecked();
  });

  it("creates a formal review with explicit ordered items and clears one-time delivery data", async () => {
    renderShareCenter(actions);
    fireEvent.click(
      await screen.findByRole("button", { name: "展开 主播甲 历史版本" }),
    );
    fireEvent.click(screen.getByLabelText("选择 主播甲 V1"));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));

    expect(await screen.findByLabelText("正式复核")).toBeChecked();
    expect(screen.getByLabelText("需要访问码")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByText("甲方将看到 1 条录屏")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() => {
      expect(actions.createAdmissionShareBoard).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({
          mode: "formal_review",
          requireAccessCode: true,
          items: [
            expect.objectContaining({
              applicationId: "app-1",
              recordingSubmissionId: "recording-v1",
              recordingVersion: 1,
              sortOrder: 0,
            }),
          ],
        }),
      );
    });
    const dialog = screen.getByRole("dialog", { name: "一次性交付信息" });
    expect(within(dialog).getByText("24681024")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "复制完整交付信息" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "关闭交付信息" }),
    );
    expect(screen.queryByText("24681024")).not.toBeInTheDocument();
    expect(
      screen.queryByText("https://app.example/share/admission/plain-token"),
    ).not.toBeInTheDocument();
  });

  it("defaults preview mode to no access code", async () => {
    renderShareCenter(actions);
    fireEvent.click(await screen.findByLabelText("选择 主播甲 V2"));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));

    fireEvent.click(await screen.findByLabelText("仅预览"));
    expect(screen.getByLabelText("需要访问码")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    await waitFor(() =>
      expect(actions.createAdmissionShareBoard).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({
          mode: "preview",
          requireAccessCode: false,
        }),
      ),
    );
  });

  it("searches, filters sources, expands versions, and opens only the authenticated playback route", async () => {
    renderShareCenter(actions);

    expect(await screen.findByText("主播甲")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索主播"), {
      target: { value: "ks_3" },
    });
    expect(screen.getByText("主播丙")).toBeInTheDocument();
    expect(screen.queryByText("主播乙")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("来源筛选"), {
      target: { value: "original" },
    });
    expect(screen.queryByText("主播丙")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索主播"), {
      target: { value: "" },
    });
    expect(screen.getByText("主播甲")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "播放 主播甲 V2" }));
    expect(actions.openAdmissionShareCandidatePlayback).toHaveBeenCalledWith(
      "project-1",
      "recording-v2",
    );

    fireEvent.change(screen.getByLabelText("来源筛选"), {
      target: { value: "all" },
    });
    fireEvent.click(screen.getByLabelText("只看可分享"));
    expect(screen.queryByText("主播乙")).not.toBeInTheDocument();
  });

  it("preserves explicit selection order and allows reordering", async () => {
    renderShareCenter(actions);
    fireEvent.click(await screen.findByLabelText("选择 主播甲 V2"));
    fireEvent.click(screen.getByLabelText("选择 主播丙 V1"));
    fireEvent.click(screen.getByRole("button", { name: "上移 主播丙 V1" }));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));

    await waitFor(() =>
      expect(actions.preflightAdmissionShareBoard).toHaveBeenCalledWith(
        "project-1",
        [
          expect.objectContaining({
            recordingSubmissionId: "recording-external",
            sortOrder: 0,
          }),
          expect.objectContaining({
            recordingSubmissionId: "recording-v2",
            sortOrder: 1,
          }),
        ],
      ),
    );
  });

  it("removes blocked items but keeps external-only warnings in the review", async () => {
    actions.preflightAdmissionShareBoard.mockResolvedValueOnce({
      summary: { ready: 1, warning: 1, blocked: 1 },
      items: [
        {
          ...latestCandidate,
          sortOrder: 0,
          status: "ready",
          reasonCode: null,
        },
        {
          ...warningCandidate,
          sortOrder: 1,
          status: "warning",
          reasonCode: "EXTERNAL_ONLY",
        },
        {
          ...blockedCandidate,
          sortOrder: 2,
          status: "blocked",
          reasonCode: "MCN_APPROVAL_REQUIRED",
        },
      ],
    });
    renderShareCenter(actions);

    fireEvent.click(await screen.findByLabelText("选择 主播甲 V2"));
    fireEvent.click(screen.getByLabelText("选择 主播丙 V1"));
    fireEvent.click(screen.getByLabelText("选择 主播乙 V2"));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "移除异常并继续" }),
    );

    expect(screen.getByText("已选择 2 条")).toBeInTheDocument();
    expect(
      screen.getByText("仅有外部链接，建议确认可访问性"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("选择 主播乙 V2")).not.toBeChecked();
  });

  it("manages historical tasks without exposing an old link", async () => {
    actions.listAdmissionShareBoards.mockResolvedValue([
      {
        id: "share-history",
        title: "第一轮复核",
        purpose: "首轮筛选",
        mode: "formal_review",
        status: "expired",
        reviewState: "submitted_locked",
        roundNumber: 1,
        expiresAt: "2026-07-29T00:00:00.000Z",
        itemCount: 3,
        draftCompletedCount: 3,
        lastSubmittedAt: "2026-07-28T08:00:00.000Z",
        createdAt: "2026-07-20T08:00:00.000Z",
      },
    ]);
    actions.listAdmissionShareSubmissions.mockResolvedValue([
      {
        id: "submission-1",
        revision: 1,
        submittedAt: "2026-07-28T08:00:00.000Z",
      },
    ]);
    renderShareCenter(actions);

    fireEvent.click(await screen.findByRole("tab", { name: "分享任务" }));
    expect(await screen.findByText("第一轮复核")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "复制旧链接" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重置分享链接" }));
    expect(actions.rotateAdmissionShareBoardToken).toHaveBeenCalledWith(
      "project-1",
      "share-history",
    );
    expect(
      await screen.findByText(
        "https://app.example/share/admission/rotated-token",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭交付信息" }));

    fireEvent.change(screen.getByLabelText("第一轮复核 延期至"), {
      target: { value: "2026-08-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "延期 第一轮复核" }));
    await waitFor(() =>
      expect(actions.extendAdmissionShareBoard).toHaveBeenCalledWith(
        "project-1",
        "share-history",
        expect.stringContaining("2026-08-20"),
      ),
    );

    fireEvent.change(screen.getByLabelText("第一轮复核 重开原因"), {
      target: { value: "甲方需要补充判断" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重开 第一轮复核" }));
    expect(actions.reopenAdmissionShareBoard).toHaveBeenCalledWith(
      "project-1",
      "share-history",
      "甲方需要补充判断",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "查看 第一轮复核 提交历史" }),
    );
    expect(await screen.findByText(/第 1 次提交/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销 第一轮复核" }));
    expect(actions.revokeAdmissionShareBoard).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "确认撤销 第一轮复核" }),
    );
    expect(actions.revokeAdmissionShareBoard).toHaveBeenCalledWith(
      "project-1",
      "share-history",
    );
  });

  it("loads playback issues on demand and resolves an open item", async () => {
    actions.listAdmissionSharePlaybackIssues.mockResolvedValue([
      {
        id: "issue-1",
        shareBoardId: "share-1",
        recordingSubmissionId: "recording-v1",
        recordingVersion: 1,
        streamerDisplayName: "主播甲",
        sourceType: "original",
        errorCode: "PLAYBACK_FAILED",
        status: "open",
        reportedAt: "2026-07-30T08:00:00.000Z",
        resolvedAt: null,
      },
    ]);
    renderShareCenter(actions);

    fireEvent.click(await screen.findByRole("tab", { name: "结果待办" }));
    expect(await screen.findByText("PLAYBACK_FAILED")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "标记已解决" }));

    await waitFor(() =>
      expect(actions.resolveAdmissionSharePlaybackIssue).toHaveBeenCalledWith(
        "project-1",
        "issue-1",
      ),
    );
  });

  it("uses a fixed, accessible selection bar with 44px critical actions", async () => {
    renderShareCenter(actions);
    fireEvent.click(await screen.findByLabelText("选择 主播甲 V2"));

    const bar = screen.getByRole("region", { name: "已选择录屏" });
    expect(bar).toHaveStyle({ position: "sticky" });
    expect(within(bar).getByRole("button", { name: "创建分享" })).toHaveStyle({
      minHeight: "44px",
    });
  });
});
