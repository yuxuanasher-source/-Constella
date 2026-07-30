import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdmissionShareCenter,
  taskCapabilities,
} from "./admission-share-center";

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

const project = {
  id: "project-1",
  name: "Alpha Project",
  status: "active",
};

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

  it("derives every task action from one lifecycle capability matrix", () => {
    const now = "2026-07-30T12:00:00.000Z";
    expect(
      taskCapabilities(
        {
          mode: "formal_review",
          status: "active",
          reviewState: "submitted_locked",
          expiresAt: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toMatchObject({
      extend: true,
      rotate: true,
      reopen: true,
      revoke: true,
      submissions: true,
    });
    expect(
      taskCapabilities(
        {
          mode: "formal_review",
          status: "expired",
          reviewState: "submitted_locked",
          expiresAt: "2026-07-29T00:00:00.000Z",
        },
        now,
      ),
    ).toMatchObject({
      extend: false,
      rotate: false,
      reopen: false,
      revoke: true,
      submissions: true,
      explanation: expect.stringContaining("已过期"),
    });
    expect(
      taskCapabilities(
        {
          mode: "preview",
          status: "active",
          reviewState: "not_started",
          expiresAt: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toMatchObject({
      extend: true,
      rotate: true,
      reopen: false,
      revoke: true,
      submissions: false,
      explanation: expect.stringContaining("预览"),
    });
    expect(
      taskCapabilities(
        {
          mode: "formal_review",
          status: "revoked",
          reviewState: "submitted_locked",
          expiresAt: "2026-08-01T00:00:00.000Z",
        },
        now,
      ),
    ).toMatchObject({
      extend: false,
      rotate: false,
      reopen: false,
      revoke: false,
      submissions: true,
      explanation: expect.stringContaining("撤销"),
    });
  });

  it("keeps history viewable but blocks new selection and creation after the project lifecycle gate closes", async () => {
    actions.listAdmissionShareBoards.mockResolvedValue([
      {
        id: "share-history",
        title: "历史复核",
        mode: "formal_review",
        status: "revoked",
        reviewState: "submitted_locked",
        expiresAt: "2026-07-29T00:00:00.000Z",
        itemCount: 1,
        draftCompletedCount: 1,
      },
    ]);
    render(
      <AdmissionShareCenter
        project={{ ...project, status: "settling" }}
        actions={actions}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("项目已进入结算阶段，不能新建录屏分享"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("选择 主播甲 V2")).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建分享" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: "分享任务" }));
    expect(await screen.findByText("历史复核")).toBeInTheDocument();
  });

  it("loads candidates and tasks independently with a scoped retry", async () => {
    actions.listAdmissionShareCandidates
      .mockRejectedValueOnce(new Error("candidate unavailable"))
      .mockResolvedValueOnce(candidates);
    actions.listAdmissionShareBoards.mockResolvedValue([
      {
        id: "share-live",
        title: "仍可查看的任务",
        mode: "preview",
        status: "active",
        reviewState: "not_started",
        expiresAt: "2099-08-01T00:00:00.000Z",
        itemCount: 1,
        draftCompletedCount: 0,
      },
    ]);
    renderShareCenter(actions);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "录屏库加载失败：candidate unavailable",
    );
    fireEvent.click(screen.getByRole("tab", { name: "分享任务" }));
    expect(await screen.findByText("仍可查看的任务")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "录屏库" }));
    fireEvent.click(screen.getByRole("button", { name: "重试加载录屏库" }));
    expect(await screen.findByText("主播甲")).toBeInTheDocument();
    expect(actions.listAdmissionShareCandidates).toHaveBeenCalledTimes(2);
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

  it("shows only lifecycle-legal actions for an expired historical task", async () => {
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
    expect(
      screen.queryByRole("button", { name: "重置分享链接" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "延期 第一轮复核" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重开 第一轮复核" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/任务已过期/)).toBeInTheDocument();

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

  it("returns stale create conflicts to preflight and keeps stale items removable", async () => {
    const staleError = Object.assign(new Error("部分录屏状态已变化"), {
      code: "SHARE_SELECTION_CHANGED",
      items: [
        {
          ...latestCandidate,
          sortOrder: 0,
          status: "blocked",
          sourceHealth: "blocked",
          reasonCode: "SELECTION_STALE",
        },
      ],
    });
    actions.createAdmissionShareBoard.mockRejectedValueOnce(staleError);
    renderShareCenter(actions);

    fireEvent.click(await screen.findByLabelText("选择 主播甲 V2"));
    fireEvent.click(screen.getByLabelText("选择 主播丙 V1"));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));
    fireEvent.click(await screen.findByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    const wizard = screen.getByRole("dialog", { name: "创建录屏分享" });
    expect(await within(wizard).findByRole("alert")).toHaveTextContent(
      "部分录屏状态已变化",
    );
    expect(within(wizard).getByText("1 条录屏无法分享")).toBeInTheDocument();
    fireEvent.click(
      within(wizard).getByRole("button", { name: "移除异常并继续" }),
    );
    expect(screen.getByText("已选择 1 条")).toBeInTheDocument();
    expect(screen.getByLabelText("选择 主播甲 V2")).not.toBeChecked();
    expect(screen.getByLabelText("选择 主播丙 V1")).toBeChecked();
  });

  it("clears a custom access code whenever the wizard or delivery closes", async () => {
    renderShareCenter(actions);
    fireEvent.click(await screen.findByLabelText("选择 主播甲 V2"));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));
    fireEvent.change(await screen.findByLabelText("自定义访问码"), {
      target: { value: "secret-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭创建向导" }));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));
    expect(await screen.findByLabelText("自定义访问码")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("自定义访问码"), {
      target: { value: "secret-456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "关闭交付信息" }),
    );

    fireEvent.click(screen.getByLabelText("选择 主播甲 V2"));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));
    expect(await screen.findByLabelText("自定义访问码")).toHaveValue("");
  });

  it("traps focus in nested dialogs, supports Escape, and restores the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "外部入口";
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    renderShareCenter(actions, onClose);

    const center = await screen.findByRole("dialog", {
      name: "Alpha Project 录屏分享中心",
    });
    expect(screen.getByRole("tab", { name: "录屏库" })).toHaveFocus();
    fireEvent.click(screen.getByLabelText("选择 主播甲 V2"));
    const createButton = screen.getByRole("button", { name: "创建分享" });
    createButton.focus();
    fireEvent.click(createButton);

    const wizard = await screen.findByRole("dialog", { name: "创建录屏分享" });
    expect(center).toHaveAttribute("inert");
    const closeWizard = within(wizard).getByRole("button", {
      name: "关闭创建向导",
    });
    expect(closeWizard).toHaveFocus();
    fireEvent.keyDown(wizard, { key: "Tab", shiftKey: true });
    expect(
      within(wizard).getByRole("button", { name: "下一步" }),
    ).toHaveFocus();
    fireEvent.keyDown(wizard, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "创建录屏分享" })).toBeNull();
    expect(createButton).toHaveFocus();

    fireEvent.keyDown(center, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("uses roving tab focus for arrows, Home, and End", async () => {
    renderShareCenter(actions);
    const library = await screen.findByRole("tab", { name: "录屏库" });
    const tasksTab = screen.getByRole("tab", { name: "分享任务" });
    const results = screen.getByRole("tab", { name: "结果待办" });

    expect(library).toHaveAttribute("tabindex", "0");
    expect(tasksTab).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(library, { key: "End" });
    expect(results).toHaveFocus();
    expect(results).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(results, { key: "Home" });
    expect(library).toHaveFocus();
    fireEvent.keyDown(library, { key: "ArrowRight" });
    expect(tasksTab).toHaveFocus();
  });

  it("locks every action for one task while its sensitive mutation is pending", async () => {
    let finishExtend;
    actions.extendAdmissionShareBoard.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishExtend = resolve;
        }),
    );
    actions.listAdmissionShareBoards.mockResolvedValue([
      {
        id: "share-live",
        title: "进行中复核",
        mode: "formal_review",
        status: "active",
        reviewState: "submitted_locked",
        expiresAt: "2099-08-01T00:00:00.000Z",
        itemCount: 1,
        draftCompletedCount: 1,
      },
    ]);
    renderShareCenter(actions);
    fireEvent.click(await screen.findByRole("tab", { name: "分享任务" }));
    fireEvent.change(await screen.findByLabelText("进行中复核 延期至"), {
      target: { value: "2099-08-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "延期 进行中复核" }));

    expect(screen.getByRole("button", { name: "重置分享链接" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "重开 进行中复核" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "查看 进行中复核 提交历史" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "撤销 进行中复核" }),
    ).toBeDisabled();

    finishExtend({ ok: true });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "重置分享链接" }),
      ).not.toBeDisabled(),
    );
  });

  it("announces copy status inside delivery and treats execCommand false as failure", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    renderShareCenter(actions);
    fireEvent.click(await screen.findByLabelText("选择 主播甲 V2"));
    fireEvent.click(screen.getByRole("button", { name: "创建分享" }));
    fireEvent.click(await screen.findByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));

    const delivery = await screen.findByRole("dialog", {
      name: "一次性交付信息",
    });
    const copyButton = within(delivery).getByRole("button", {
      name: "复制完整交付信息",
    });
    fireEvent.click(copyButton);
    expect(copyButton).toBeDisabled();
    expect(await within(delivery).findByRole("status")).toHaveTextContent(
      "复制失败",
    );
    await waitFor(() => expect(copyButton).not.toBeDisabled());
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
    expect(bar).not.toHaveStyle({
      boxShadow: "0 -8px 24px rgba(15, 23, 42, 0.08)",
    });
    expect(
      Array.from(document.querySelectorAll("style")).some((style) =>
        style.textContent.includes("prefers-reduced-motion"),
      ),
    ).toBe(true);
  });
});
