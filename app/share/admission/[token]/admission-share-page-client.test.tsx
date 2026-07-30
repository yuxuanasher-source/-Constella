import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdmissionSharePageClient from "./admission-share-page-client";
import {
  authenticateAdmissionShareAccess,
  loadAdmissionShareBoard,
  loadAdmissionShareDrafts,
  PublicAdmissionShareApiError,
  reportAdmissionSharePlaybackIssue,
  saveAdmissionShareDraft,
  submitAdmissionShareReview,
} from "./admission-share-api";
import type {
  AdmissionShareReviewDraftDto,
  PublicAdmissionShareBoard,
} from "./admission-share-types";

vi.mock("./admission-share-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./admission-share-api")>();
  return {
    ...actual,
    authenticateAdmissionShareAccess: vi.fn(),
    loadAdmissionShareBoard: vi.fn(),
    loadAdmissionShareDrafts: vi.fn(),
    reportAdmissionSharePlaybackIssue: vi.fn(),
    saveAdmissionShareDraft: vi.fn(),
    submitAdmissionShareReview: vi.fn(),
  };
});

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
      playbackUrl:
        "/api/public/admission-share/public-token/recordings/recording-1",
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
      playbackUrl:
        "/api/public/admission-share/public-token/recordings/recording-2",
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

const serverDrafts = [
  {
    recordingSubmissionId: "recording-1",
    recordingVersion: 1,
    decision: "pending",
    remark: "",
    reasonCodes: [],
    revision: 2,
    updatedAt: "2026-07-30T08:00:00.000Z",
  },
  {
    recordingSubmissionId: "recording-2",
    recordingVersion: 1,
    decision: "backup",
    remark: "",
    reasonCodes: [],
    revision: 1,
    updatedAt: "2026-07-30T08:00:00.000Z",
  },
] satisfies AdmissionShareReviewDraftDto[];

describe("AdmissionSharePageClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadAdmissionShareBoard).mockResolvedValue({
      shareBoard: formalBoard,
      vendorCheckpoints: [
        {
          key: "product_fit",
          label: "产品匹配",
          description: "产品呈现与要求不一致",
        },
      ],
    });
    vi.mocked(loadAdmissionShareDrafts).mockResolvedValue([...serverDrafts]);
    vi.mocked(saveAdmissionShareDraft).mockImplementation(
      async (_token, _recordingId, input) => ({
        decision: input.decision,
        remark: input.remark,
        reasonCodes: input.reasonCodes,
        revision: input.expectedRevision + 1,
        updatedAt: "2026-07-30T08:30:00.000Z",
      }),
    );
    vi.mocked(submitAdmissionShareReview).mockResolvedValue({
      submissionRevision: 1,
      submittedCount: 2,
      syncedCount: 2,
      skippedCount: 0,
    });
    vi.mocked(reportAdmissionSharePlaybackIssue).mockResolvedValue({
      issueId: "issue-1",
    });
    vi.mocked(authenticateAdmissionShareAccess).mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates a formal board and its server drafts without exposing secrets", async () => {
    const { container } = render(
      <AdmissionSharePageClient token="public-token" />,
    );

    expect(await screen.findAllByText("待判断主播")).toHaveLength(2);
    expect(loadAdmissionShareBoard).toHaveBeenCalledWith("public-token");
    expect(loadAdmissionShareDrafts).toHaveBeenCalledWith("public-token");
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue("");
    expect(container.textContent).not.toContain("tokenHash");
    expect(container.textContent).not.toContain("storagePath");
    expect(container.textContent).not.toContain("accessCode");
  });

  it("autosaves a remark after 500ms with the current CAS revision", async () => {
    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "需要补充产品卖点" },
    });
    expect(saveAdmissionShareDraft).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveAdmissionShareDraft).toHaveBeenCalledWith(
      "public-token",
      "recording-1",
      expect.objectContaining({
        expectedRevision: 2,
        remark: "需要补充产品卖点",
      }),
    );
  });

  it("keeps newer local text when an older save resolves and advances the CAS revision", async () => {
    const firstSave = deferred<{
      decision: "selected";
      remark: string;
      reasonCodes: string[];
      revision: number;
      updatedAt: string;
    }>();
    vi.mocked(saveAdmissionShareDraft)
      .mockReturnValueOnce(firstSave.promise)
      .mockImplementationOnce(async (_token, _recordingId, input) => ({
        decision: input.decision,
        remark: input.remark,
        reasonCodes: input.reasonCodes,
        revision: 4,
        updatedAt: "2026-07-30T08:32:00.000Z",
      }));

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.click(screen.getByLabelText("入选"));
    await waitFor(() =>
      expect(saveAdmissionShareDraft).toHaveBeenCalledTimes(1),
    );

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "保留这段新备注" },
    });
    await act(async () => {
      firstSave.resolve({
        decision: "selected",
        remark: "",
        reasonCodes: [],
        revision: 3,
        updatedAt: "2026-07-30T08:31:00.000Z",
      });
      await Promise.resolve();
    });
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue("保留这段新备注");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveAdmissionShareDraft).toHaveBeenLastCalledWith(
      "public-token",
      "recording-1",
      expect.objectContaining({
        expectedRevision: 3,
        remark: "保留这段新备注",
      }),
    );
  });

  it("waits for an old save and then adopts a newer server revision", async () => {
    const oldSave = deferred<{
      decision: "selected";
      remark: string;
      reasonCodes: string[];
      revision: number;
      updatedAt: string;
    }>();
    vi.mocked(saveAdmissionShareDraft)
      .mockReturnValueOnce(oldSave.promise)
      .mockImplementationOnce(async (_token, _recordingId, input) => ({
        decision: input.decision,
        remark: input.remark,
        reasonCodes: input.reasonCodes,
        revision: 11,
        updatedAt: "2026-07-30T08:40:00.000Z",
      }));
    vi.mocked(loadAdmissionShareDrafts)
      .mockResolvedValueOnce([...serverDrafts])
      .mockResolvedValueOnce([
        {
          ...serverDrafts[0],
          decision: "backup",
          remark: "服务器刷新后的备注",
          revision: 10,
        },
        serverDrafts[1],
      ]);
    vi.mocked(reportAdmissionSharePlaybackIssue).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "播放问题反馈失败，请稍后重试。",
        "SHARE_SERVICE_UNAVAILABLE",
        503,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.click(screen.getByLabelText("入选"));
    await waitFor(() =>
      expect(saveAdmissionShareDraft).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    expect(
      await screen.findByText("播放问题反馈失败，请稍后重试。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(loadAdmissionShareDrafts).toHaveBeenCalledTimes(1);

    await act(async () => {
      oldSave.resolve({
        decision: "selected",
        remark: "",
        reasonCodes: [],
        revision: 3,
        updatedAt: "2026-07-30T08:31:00.000Z",
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(loadAdmissionShareDrafts).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByLabelText("备选")).toBeChecked();
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue(
      "服务器刷新后的备注",
    );

    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "刷新后继续修改" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveAdmissionShareDraft).toHaveBeenLastCalledWith(
      "public-token",
      "recording-1",
      expect.objectContaining({
        expectedRevision: 10,
        remark: "刷新后继续修改",
      }),
    );
  });

  it("adopts a newer remote revision after the local draft was already saved", async () => {
    vi.mocked(loadAdmissionShareDrafts)
      .mockResolvedValueOnce([...serverDrafts])
      .mockResolvedValueOnce([
        {
          ...serverDrafts[0],
          decision: "needs_changes",
          remark: "另一位复核人提交的新备注",
          reasonCodes: ["product_fit"],
          revision: 5,
        },
        serverDrafts[1],
      ]);
    vi.mocked(reportAdmissionSharePlaybackIssue).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "播放问题反馈失败，请稍后重试。",
        "SHARE_SERVICE_UNAVAILABLE",
        503,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.click(screen.getByLabelText("入选"));
    await waitFor(() =>
      expect(saveAdmissionShareDraft).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    await screen.findByText("播放问题反馈失败，请稍后重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() =>
      expect(loadAdmissionShareDrafts).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByLabelText("需修改")).toBeChecked();
    expect(screen.getByLabelText("产品匹配")).toBeChecked();
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue(
      "另一位复核人提交的新备注",
    );
    expect(screen.getByRole("status")).toHaveTextContent("已保存");
  });

  it("does not downgrade a confirmed local revision when hydration returns older data", async () => {
    vi.mocked(saveAdmissionShareDraft).mockImplementationOnce(
      async (_token, _recordingId, input) => ({
        decision: input.decision,
        remark: input.remark,
        reasonCodes: input.reasonCodes,
        revision: 6,
        updatedAt: "2026-07-30T08:35:00.000Z",
      }),
    );
    vi.mocked(loadAdmissionShareDrafts)
      .mockResolvedValueOnce([...serverDrafts])
      .mockResolvedValueOnce([
        {
          ...serverDrafts[0],
          decision: "backup",
          remark: "延迟副本",
          revision: 5,
        },
        serverDrafts[1],
      ]);
    vi.mocked(reportAdmissionSharePlaybackIssue).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "播放问题反馈失败，请稍后重试。",
        "SHARE_SERVICE_UNAVAILABLE",
        503,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.click(screen.getByLabelText("入选"));
    await waitFor(() =>
      expect(saveAdmissionShareDraft).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    await screen.findByText("播放问题反馈失败，请稍后重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() =>
      expect(loadAdmissionShareDrafts).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByLabelText("入选")).toBeChecked();
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue("");
  });

  it("waits for a dirty draft save to settle before loading stale server data", async () => {
    const pendingSave = deferred<{
      decision: "pending";
      remark: string;
      reasonCodes: string[];
      revision: number;
      updatedAt: string;
    }>();
    vi.mocked(saveAdmissionShareDraft).mockReturnValueOnce(pendingSave.promise);
    vi.mocked(loadAdmissionShareDrafts)
      .mockResolvedValueOnce([...serverDrafts])
      .mockResolvedValueOnce([...serverDrafts]);
    vi.mocked(reportAdmissionSharePlaybackIssue).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "播放问题反馈失败，请稍后重试。",
        "SHARE_SERVICE_UNAVAILABLE",
        503,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "必须先保存再读取" },
    });
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    await screen.findByText("播放问题反馈失败，请稍后重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() =>
      expect(saveAdmissionShareDraft).toHaveBeenCalledTimes(1),
    );
    expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingSave.resolve({
        decision: "pending",
        remark: "必须先保存再读取",
        reasonCodes: [],
        revision: 3,
        updatedAt: "2026-07-30T08:31:00.000Z",
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue(
      "必须先保存再读取",
    );
  });

  it("retries and settles a failed dirty draft before ordinary hydration", async () => {
    const retrySave = deferred<{
      decision: "pending";
      remark: string;
      reasonCodes: string[];
      revision: number;
      updatedAt: string;
    }>();
    vi.mocked(saveAdmissionShareDraft)
      .mockRejectedValueOnce(
        new PublicAdmissionShareApiError(
          "草稿暂时无法保存。",
          "SHARE_SERVICE_UNAVAILABLE",
          503,
        ),
      )
      .mockReturnValueOnce(retrySave.promise);
    vi.mocked(reportAdmissionSharePlaybackIssue).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "播放问题反馈失败，请稍后重试。",
        "SHARE_SERVICE_UNAVAILABLE",
        503,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "失败草稿也要先重试" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    vi.useRealTimers();
    expect(screen.getByRole("status")).toHaveTextContent("保存失败");

    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    await screen.findByText("播放问题反馈失败，请稍后重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() =>
      expect(saveAdmissionShareDraft).toHaveBeenCalledTimes(2),
    );
    expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      retrySave.resolve({
        decision: "pending",
        remark: "失败草稿也要先重试",
        reasonCodes: [],
        revision: 3,
        updatedAt: "2026-07-30T08:32:00.000Z",
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(2),
    );
  });

  it("flushes and preserves a pending remark before an ordinary reload", async () => {
    vi.mocked(loadAdmissionShareDrafts)
      .mockResolvedValueOnce([...serverDrafts])
      .mockResolvedValueOnce([...serverDrafts]);
    vi.mocked(reportAdmissionSharePlaybackIssue).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "播放问题反馈失败，请稍后重试。",
        "SHARE_SERVICE_UNAVAILABLE",
        503,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "普通刷新也必须保留的备注" },
    });
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    expect(
      await screen.findByText("播放问题反馈失败，请稍后重试。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() =>
      expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(2),
    );
    expect(saveAdmissionShareDraft).toHaveBeenCalledWith(
      "public-token",
      "recording-1",
      expect.objectContaining({ remark: "普通刷新也必须保留的备注" }),
    );
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue(
      "普通刷新也必须保留的备注",
    );
  });

  it("flushes a pending remark before switching recordings", async () => {
    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "切换前保存" },
    });
    fireEvent.click(screen.getByRole("button", { name: /已完成主播/ }));

    expect(saveAdmissionShareDraft).toHaveBeenCalledWith(
      "public-token",
      "recording-1",
      expect.objectContaining({ remark: "切换前保存" }),
    );
  });

  it("flushes pending remarks on beforeunload without updating an unmounted view", async () => {
    const save = deferred<{
      decision: "pending";
      remark: string;
      reasonCodes: string[];
      revision: number;
      updatedAt: string;
    }>();
    vi.mocked(saveAdmissionShareDraft).mockReturnValueOnce(save.promise);
    const { unmount } = render(
      <AdmissionSharePageClient token="public-token" />,
    );
    await screen.findAllByText("待判断主播");
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "离开前保存" },
    });
    window.dispatchEvent(new Event("beforeunload"));
    expect(saveAdmissionShareDraft).toHaveBeenCalledWith(
      "public-token",
      "recording-1",
      expect.objectContaining({ remark: "离开前保存" }),
    );
    unmount();
    await act(async () => {
      save.resolve({
        decision: "pending",
        remark: "离开前保存",
        reasonCodes: [],
        revision: 3,
        updatedAt: "2026-07-30T08:31:00.000Z",
      });
      await Promise.resolve();
    });
  });

  it("keeps local values and asks for refresh on a draft conflict", async () => {
    vi.mocked(saveAdmissionShareDraft).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "其他复核人刚刚更新了结果，请刷新后查看最新内容。",
        "DRAFT_CONFLICT",
        409,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "需要补充产品卖点" },
    });
    fireEvent.click(screen.getByLabelText("需修改"));

    expect(await screen.findByText(/其他复核人刚刚更新/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "刷新最新结果" }).className,
    ).toMatch(/\bmin-h-11\b/);
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue(
      "需要补充产品卖点",
    );

    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "冲突后继续记录在本地" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("保存失败");
    expect(saveAdmissionShareDraft).toHaveBeenCalledTimes(1);
  });

  it("saves a positive decision atomically without stale negative reasons", async () => {
    vi.mocked(loadAdmissionShareDrafts).mockResolvedValue([
      {
        ...serverDrafts[0],
        decision: "needs_changes",
        remark: "需要补充产品卖点",
        reasonCodes: ["product_fit"],
      },
      serverDrafts[1],
    ]);

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.click(screen.getByLabelText("入选"));

    await waitFor(() =>
      expect(saveAdmissionShareDraft).toHaveBeenCalledWith(
        "public-token",
        "recording-1",
        {
          expectedRevision: 2,
          decision: "selected",
          remark: "需要补充产品卖点",
          reasonCodes: [],
        },
      ),
    );
  });

  it("retries a non-conflict save from the item without rehydrating or losing local values", async () => {
    vi.mocked(loadAdmissionShareDrafts).mockResolvedValue([
      {
        ...serverDrafts[0],
        decision: "needs_changes",
        remark: "服务器旧备注",
        reasonCodes: ["product_fit"],
      },
      serverDrafts[1],
    ]);
    vi.mocked(saveAdmissionShareDraft).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "草稿暂时无法保存，请保留页面并稍后重试。",
        "SHARE_SERVICE_UNAVAILABLE",
        503,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "保留本地决定、原因和备注" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(screen.getByRole("status")).toHaveTextContent("保存失败");
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("需修改")).toBeChecked();
    expect(screen.getByLabelText("产品匹配")).toBeChecked();
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue(
      "保留本地决定、原因和备注",
    );

    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(saveAdmissionShareDraft).toHaveBeenCalledTimes(2);
    expect(saveAdmissionShareDraft).toHaveBeenLastCalledWith(
      "public-token",
      "recording-1",
      {
        expectedRevision: 2,
        decision: "needs_changes",
        remark: "保留本地决定、原因和备注",
        reasonCodes: ["product_fit"],
      },
    );
    expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(1);
    expect(loadAdmissionShareDrafts).toHaveBeenCalledTimes(1);
  });

  it("hides a protected workspace after session loss and restores dirty values on reauthentication", async () => {
    vi.mocked(loadAdmissionShareDrafts)
      .mockResolvedValueOnce([
        {
          ...serverDrafts[0],
          decision: "needs_changes",
          remark: "服务器旧备注",
          reasonCodes: ["product_fit"],
        },
        serverDrafts[1],
      ])
      .mockResolvedValueOnce([
        {
          ...serverDrafts[0],
          decision: "backup",
          remark: "其他复核人更新的远端备注",
          reasonCodes: [],
          revision: 7,
          updatedAt: "2026-07-30T09:00:00.000Z",
        },
        serverDrafts[1],
      ]);
    vi.mocked(saveAdmissionShareDraft).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "安全会话已失效，请重新输入访问码。",
        "ACCESS_CODE_REQUIRED",
        401,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "会话失效前的本地备注" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    vi.useRealTimers();

    expect(
      screen.queryByRole("region", { name: "录屏复核工作台" }),
    ).not.toBeInTheDocument();
    const accessCode = await screen.findByLabelText("访问码");
    expect(accessCode).toHaveFocus();

    fireEvent.change(accessCode, { target: { value: "246810" } });
    fireEvent.click(screen.getByRole("button", { name: "验证访问码" }));

    expect(await screen.findAllByText("待判断主播")).toHaveLength(2);
    expect(screen.getByLabelText("需修改")).toBeChecked();
    expect(screen.getByLabelText("产品匹配")).toBeChecked();
    expect(screen.getByLabelText("当前录屏备注")).toHaveValue(
      "会话失效前的本地备注",
    );
    expect(screen.getByRole("status")).toHaveTextContent("保存失败");

    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() =>
      expect(saveAdmissionShareDraft).toHaveBeenCalledTimes(2),
    );
    expect(saveAdmissionShareDraft).toHaveBeenLastCalledWith(
      "public-token",
      "recording-1",
      {
        expectedRevision: 7,
        decision: "needs_changes",
        remark: "会话失效前的本地备注",
        reasonCodes: ["product_fit"],
      },
    );
  });

  it("stops hydration before GET when a dirty save loses access", async () => {
    const expiredSave = deferred<{
      decision: "selected";
      remark: string;
      reasonCodes: string[];
      revision: number;
      updatedAt: string;
    }>();
    vi.mocked(loadAdmissionShareBoard).mockResolvedValueOnce({
      shareBoard: formalBoard,
      vendorCheckpoints: [],
    });
    vi.mocked(saveAdmissionShareDraft).mockReturnValueOnce(expiredSave.promise);
    vi.mocked(reportAdmissionSharePlaybackIssue).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "播放问题反馈失败，请稍后重试。",
        "SHARE_SERVICE_UNAVAILABLE",
        503,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.click(screen.getByLabelText("入选"));
    fireEvent.click(screen.getByRole("button", { name: "反馈播放问题" }));
    expect(
      await screen.findByText("播放问题反馈失败，请稍后重试。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      expiredSave.reject(
        new PublicAdmissionShareApiError(
          "安全会话已失效，请重新输入访问码。",
          "UNAUTHORIZED",
          401,
        ),
      );
      await Promise.resolve();
    });
    expect(await screen.findByLabelText("访问码")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "录屏复核工作台" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("访问码")).toBeInTheDocument();
  });

  it("announces access-code errors and returns focus to the input", async () => {
    vi.mocked(loadAdmissionShareBoard).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "请输入访问码后继续。",
        "ACCESS_CODE_REQUIRED",
        401,
      ),
    );
    vi.mocked(authenticateAdmissionShareAccess).mockRejectedValueOnce(
      new PublicAdmissionShareApiError(
        "访问码错误，请重新输入。",
        "ACCESS_CODE_INVALID",
        401,
      ),
    );

    render(<AdmissionSharePageClient token="public-token" />);
    const accessCode = await screen.findByLabelText("访问码");
    expect(accessCode).toHaveFocus();
    fireEvent.change(accessCode, { target: { value: "wrong-code" } });
    fireEvent.click(screen.getByRole("button", { name: "验证访问码" }));

    expect(
      await screen.findByRole("alert", { name: "访问码验证错误" }),
    ).toHaveTextContent("访问码错误，请重新输入。");
    expect(accessCode).toHaveFocus();
  });

  it("opens an accessible summary only after every draft is complete", async () => {
    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");

    expect(screen.getByRole("button", { name: "查看提交汇总" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("需修改"));
    fireEvent.click(screen.getByLabelText("产品匹配"));
    fireEvent.change(screen.getByLabelText("当前录屏备注"), {
      target: { value: "请补充产品卖点" },
    });

    const summaryButton = screen.getByRole("button", {
      name: "查看提交汇总",
    });
    expect(summaryButton).toBeEnabled();
    fireEvent.click(summaryButton);
    const dialog = screen.getByRole("dialog", { name: "提交复核汇总" });
    expect(dialog).toHaveTextContent("需修改");
    expect(dialog).toHaveTextContent("备选");
    expect(screen.getByLabelText("项目整体备注")).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "关闭提交汇总" }).className,
    ).toMatch(/\b(?:h-11|min-h-11)\b/);
  });

  it("submits only projectRemark once, reloads, and renders the locked receipt", async () => {
    const lockedBoard: PublicAdmissionShareBoard = {
      ...formalBoard,
      canSubmit: false,
      reviewState: "submitted_locked",
      progress: { completed: 2, total: 2 },
      latestSubmission: {
        revision: 1,
        submittedAt: "2026-07-30T09:00:00.000Z",
        summary: {
          selected: 1,
          backup: 1,
          rejected: 0,
          needsChanges: 0,
        },
      },
      items: formalBoard.items.map((item, index) => ({
        ...item,
        finalReview: {
          decision: index === 0 ? "selected" : "backup",
          remark: index === 0 ? "匹配" : "",
          reasonCodes: [],
          submittedAt: "2026-07-30T09:00:00.000Z",
        },
      })),
    };
    vi.mocked(loadAdmissionShareDrafts).mockResolvedValue(
      serverDrafts.map((draft, index) => ({
        ...draft,
        decision: index === 0 ? "selected" : "backup",
      })),
    );
    vi.mocked(loadAdmissionShareBoard)
      .mockResolvedValueOnce({
        shareBoard: formalBoard,
        vendorCheckpoints: [],
      })
      .mockResolvedValueOnce({
        shareBoard: lockedBoard,
        vendorCheckpoints: [],
      });

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.click(screen.getByRole("button", { name: "查看提交汇总" }));
    fireEvent.change(screen.getByLabelText("项目整体备注"), {
      target: { value: "首轮复核完成" },
    });
    const submit = screen.getByRole("button", { name: "确认提交复核" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() =>
      expect(submitAdmissionShareReview).toHaveBeenCalledWith("public-token", {
        projectRemark: "首轮复核完成",
      }),
    );
    expect(submitAdmissionShareReview).toHaveBeenCalledTimes(1);
    expect(await screen.findAllByText("本轮复核已提交并锁定")).toHaveLength(2);
    expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(2);
  });

  it("locks immediately after POST success and retries a failed receipt with GET only", async () => {
    const completeDrafts = serverDrafts.map((draft, index) => ({
      ...draft,
      decision: index === 0 ? ("selected" as const) : ("backup" as const),
    }));
    const lockedBoard: PublicAdmissionShareBoard = {
      ...formalBoard,
      canSubmit: false,
      reviewState: "submitted_locked",
      progress: { completed: 2, total: 2 },
      latestSubmission: {
        revision: 2,
        submittedAt: "2026-07-30T09:00:00.000Z",
        summary: {
          selected: 1,
          backup: 1,
          rejected: 0,
          needsChanges: 0,
        },
      },
    };
    vi.mocked(loadAdmissionShareDrafts).mockResolvedValue(completeDrafts);
    vi.mocked(loadAdmissionShareBoard)
      .mockResolvedValueOnce({
        shareBoard: formalBoard,
        vendorCheckpoints: [],
      })
      .mockRejectedValueOnce(
        new PublicAdmissionShareApiError(
          "回执暂时无法刷新。",
          "SHARE_SERVICE_UNAVAILABLE",
          503,
        ),
      )
      .mockResolvedValueOnce({
        shareBoard: lockedBoard,
        vendorCheckpoints: [],
      });

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.click(screen.getByRole("button", { name: "查看提交汇总" }));
    fireEvent.change(screen.getByLabelText("项目整体备注"), {
      target: { value: "提交后应立即清空" },
    });
    const submit = screen.getByRole("button", { name: "确认提交复核" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(
      await screen.findByText("已提交，回执刷新失败。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "提交复核汇总" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("本轮复核已提交并锁定").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByText("提交复核失败，请稍后重试。"),
    ).not.toBeInTheDocument();
    expect(submitAdmissionShareReview).toHaveBeenCalledTimes(1);

    const receiptRetry = screen.getByRole("button", { name: "重试回执" });
    expect(receiptRetry.className).toMatch(/\bmin-h-11\b/);
    fireEvent.click(receiptRetry);
    await waitFor(() =>
      expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(3),
    );
    expect(submitAdmissionShareReview).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/回执修订 2/)).toBeInTheDocument();
  });

  it("reauthenticates an expired receipt session without resubmitting the review", async () => {
    const completeDrafts = serverDrafts.map((draft, index) => ({
      ...draft,
      decision: index === 0 ? ("selected" as const) : ("backup" as const),
    }));
    const lockedBoard: PublicAdmissionShareBoard = {
      ...formalBoard,
      canSubmit: false,
      reviewState: "submitted_locked",
      latestSubmission: {
        revision: 3,
        submittedAt: "2026-07-30T09:05:00.000Z",
        summary: {
          selected: 1,
          backup: 1,
          rejected: 0,
          needsChanges: 0,
        },
      },
    };
    vi.mocked(loadAdmissionShareDrafts).mockResolvedValue(completeDrafts);
    vi.mocked(loadAdmissionShareBoard)
      .mockResolvedValueOnce({
        shareBoard: formalBoard,
        vendorCheckpoints: [],
      })
      .mockRejectedValueOnce(
        new PublicAdmissionShareApiError(
          "安全会话已失效，请重新输入访问码。",
          "UNAUTHORIZED",
          401,
        ),
      )
      .mockResolvedValueOnce({
        shareBoard: lockedBoard,
        vendorCheckpoints: [],
      });

    render(<AdmissionSharePageClient token="public-token" />);
    await screen.findAllByText("待判断主播");
    fireEvent.click(screen.getByRole("button", { name: "查看提交汇总" }));
    fireEvent.click(screen.getByRole("button", { name: "确认提交复核" }));

    const accessCode = await screen.findByLabelText("访问码");
    expect(
      screen.queryByRole("region", { name: "录屏复核工作台" }),
    ).not.toBeInTheDocument();
    fireEvent.change(accessCode, { target: { value: "246810" } });
    fireEvent.click(screen.getByRole("button", { name: "验证访问码" }));

    expect(await screen.findByText(/回执修订 3/)).toBeInTheDocument();
    expect(authenticateAdmissionShareAccess).toHaveBeenCalledWith(
      "public-token",
      "246810",
    );
    expect(loadAdmissionShareBoard).toHaveBeenCalledTimes(3);
    expect(loadAdmissionShareDrafts).toHaveBeenCalledTimes(1);
    expect(submitAdmissionShareReview).toHaveBeenCalledTimes(1);
  });

  it("never reads or writes drafts for preview mode", async () => {
    vi.mocked(loadAdmissionShareBoard).mockResolvedValue({
      shareBoard: {
        ...formalBoard,
        mode: "preview",
        canSubmit: false,
        reviewState: "viewed",
      },
      vendorCheckpoints: [],
    });

    render(<AdmissionSharePageClient token="public-token" />);

    expect(await screen.findAllByText("待判断主播")).toHaveLength(2);
    expect(loadAdmissionShareDrafts).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("当前录屏备注")).not.toBeInTheDocument();
    expect(saveAdmissionShareDraft).not.toHaveBeenCalled();
  });

  it("authenticates an access code in a cookie-backed request and retries", async () => {
    vi.mocked(loadAdmissionShareBoard)
      .mockRejectedValueOnce(
        new PublicAdmissionShareApiError(
          "请输入访问码后继续。",
          "ACCESS_CODE_REQUIRED",
          401,
        ),
      )
      .mockResolvedValueOnce({
        shareBoard: formalBoard,
        vendorCheckpoints: [],
      });

    render(<AdmissionSharePageClient token="public-token" />);
    fireEvent.change(await screen.findByLabelText("访问码"), {
      target: { value: "246810" },
    });
    fireEvent.click(screen.getByRole("button", { name: "验证访问码" }));

    expect(await screen.findAllByText("待判断主播")).toHaveLength(2);
    expect(authenticateAdmissionShareAccess).toHaveBeenCalledWith(
      "public-token",
      "246810",
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
