import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelLiveTask,
  createLiveTask,
  reviewLiveReport,
  startLiveTask,
  stopLiveTask,
  submitLiveReport,
  type LiveOperationsRepository,
} from "./live-operations-service";

const actor = {
  userId: "user-ops",
  name: "Ops",
  role: "operator_business" as const,
  organizationId: "org-1",
};

const streamerActor = {
  userId: "user-streamer",
  name: "Streamer",
  role: "streamer" as const,
  organizationId: "org-1",
  streamerId: "streamer-1",
};

const task = {
  id: "task-1",
  organizationId: "org-1",
  projectId: "project-1",
  streamerId: "streamer-1",
  title: "Project A · Streamer 1",
  status: "pending_live" as const,
  plannedStartAt: "2026-06-02T10:00:00.000Z",
  plannedEndAt: "2026-06-02T12:00:00.000Z",
  plannedDuration: 120,
  requiresTiming: true,
  systemStartedAt: null,
  systemStoppedAt: null,
  systemDuration: 0,
};

function createRepo(): LiveOperationsRepository {
  return {
    getProjectStreamer: vi.fn(async () => ({
      id: "project-streamer-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "joined" as const,
    })),
    createLiveTask: vi.fn(async (input) => ({
      ...task,
      id: "task-created",
      organizationId: input.organizationId,
      projectId: input.projectId,
      streamerId: input.streamerId,
      title: input.title,
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      plannedDuration: input.plannedDuration,
      createdBy: input.createdBy,
    })),
    getLiveTaskById: vi.fn(async () => task),
    updateLiveTask: vi.fn(async (_taskId, patch) => ({
      ...task,
      ...patch,
    })),
    createLiveReport: vi.fn(async (input) => ({
      id: "report-1",
      organizationId: input.organizationId,
      liveTaskId: input.liveTaskId,
      projectId: input.projectId,
      streamerId: input.streamerId,
      status: "pending_review" as const,
      systemDuration: input.systemDuration,
      screenshotDuration: input.screenshotDuration,
      claimedDuration: input.claimedDuration,
      settlementDuration: input.settlementDuration,
      timeSource: input.timeSource,
      evidenceLevel: input.evidenceLevel,
      divergencePct: input.divergencePct,
      viewers: input.viewers,
      includeInTaskResult: true,
      enterSettlementPool: true,
      riskFlags: input.riskFlags,
    })),
    getLiveReportById: vi.fn(async () => ({
      id: "report-1",
      organizationId: "org-1",
      liveTaskId: "task-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "pending_review" as const,
      systemDuration: 120,
      screenshotDuration: 124,
      claimedDuration: 124,
      settlementDuration: 120,
      timeSource: "system" as const,
      evidenceLevel: "green" as const,
      divergencePct: 0.0333,
      viewers: 800,
      includeInTaskResult: true,
      enterSettlementPool: true,
      riskFlags: [],
    })),
    updateLiveReport: vi.fn(async (_reportId, patch) => ({
      id: "report-1",
      organizationId: "org-1",
      liveTaskId: "task-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: patch.status ?? ("pending_review" as const),
      systemDuration: 120,
      screenshotDuration: 124,
      claimedDuration: 124,
      settlementDuration: 120,
      timeSource: "system" as const,
      evidenceLevel: "green" as const,
      divergencePct: 0.0333,
      viewers: 800,
      includeInTaskResult: patch.includeInTaskResult ?? true,
      enterSettlementPool: patch.enterSettlementPool ?? true,
      riskFlags: [],
    })),
    createReportScreenshot: vi.fn(async () => undefined),
    createReportChangeLog: vi.fn(async () => undefined),
  };
}

describe("live operations service", () => {
  let repo: LiveOperationsRepository;
  const audit = vi.fn(async () => undefined);
  const notify = vi.fn(async () => undefined);

  beforeEach(() => {
    repo = createRepo();
    audit.mockClear();
    notify.mockClear();
  });

  it("creates tasks only for joined project streamers", async () => {
    await createLiveTask({
      repo,
      audit,
      notify,
      actor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        title: "Project A · Streamer 1",
        plannedStartAt: "2026-06-02T10:00:00.000Z",
        plannedEndAt: "2026-06-02T12:00:00.000Z",
        plannedDuration: 120,
      },
    });

    expect(repo.createLiveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        createdBy: "user-ops",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", module: "live_task" }),
    );
  });

  it("lets a streamer start and stop their own task with system timing", async () => {
    await startLiveTask({
      repo,
      audit,
      actor: streamerActor,
      taskId: "task-1",
      now: "2026-06-02T10:00:00.000Z",
    });

    expect(repo.updateLiveTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        status: "live",
        systemStartedAt: "2026-06-02T10:00:00.000Z",
      }),
    );

    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "live",
      systemStartedAt: "2026-06-02T10:00:00.000Z",
    });

    await stopLiveTask({
      repo,
      audit,
      actor: streamerActor,
      taskId: "task-1",
      now: "2026-06-02T11:30:00.000Z",
    });

    expect(repo.updateLiveTask).toHaveBeenLastCalledWith(
      "task-1",
      expect.objectContaining({
        status: "pending_report",
        systemStoppedAt: "2026-06-02T11:30:00.000Z",
        systemDuration: 90,
      }),
    );
  });

  it("lets staff cancel an uncompleted task and writes an audit reason", async () => {
    const cancelled = await cancelLiveTask({
      repo,
      audit,
      actor,
      taskId: "task-1",
      reason: "主播临时请假",
    });

    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(repo.updateLiveTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "live_task",
        objectId: "task-1",
        changedFields: ["status"],
        reason: "主播临时请假",
      }),
    );
  });

  it("blocks cancelling completed live tasks through the state machine", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "completed",
    });

    await expect(
      cancelLiveTask({
        repo,
        audit,
        actor,
        taskId: "task-1",
        reason: "误操作",
      }),
    ).rejects.toThrow(
      "Invalid live task status transition: completed -> cancelled",
    );

    expect(repo.updateLiveTask).not.toHaveBeenCalled();
  });

  it("requires streamer binding before task operations", async () => {
    await expect(
      startLiveTask({
        repo,
        audit,
        actor: { ...streamerActor, streamerId: null },
        taskId: "task-1",
        now: "2026-06-02T10:00:00.000Z",
      }),
    ).rejects.toThrow("Current streamer is not bound to a streamer profile");

    expect(repo.updateLiveTask).not.toHaveBeenCalled();
  });

  it("blocks streamers from operating another streamer's task", async () => {
    await expect(
      startLiveTask({
        repo,
        audit,
        actor: { ...streamerActor, streamerId: "streamer-2" },
        taskId: "task-1",
        now: "2026-06-02T10:00:00.000Z",
      }),
    ).rejects.toThrow("Streamers can only operate their own live tasks");

    expect(repo.updateLiveTask).not.toHaveBeenCalled();
  });

  it("blocks cross-organization task operations even if the repository returns a row", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      organizationId: "org-2",
    });

    await expect(
      startLiveTask({
        repo,
        audit,
        actor: streamerActor,
        taskId: "task-1",
        now: "2026-06-02T10:00:00.000Z",
      }),
    ).rejects.toThrow("Cross-organization access is not allowed");

    expect(repo.updateLiveTask).not.toHaveBeenCalled();
  });

  it("submits a report from a task and freezes evidence snapshot", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "pending_report",
      systemStartedAt: "2026-06-02T10:00:00.000Z",
      systemStoppedAt: "2026-06-02T12:00:00.000Z",
      systemDuration: 120,
    });

    const report = await submitLiveReport({
      repo,
      audit,
      notify,
      actor: streamerActor,
      taskId: "task-1",
      input: {
        screenshotStoragePath: "private/reports/task-1/end.png",
        screenshotFileHash: "hash-1",
        screenshotDuration: 122,
        claimedDuration: 122,
        viewers: 952,
      },
    });

    expect(report).toMatchObject({
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
      status: "pending_review",
    });
    expect(repo.updateLiveTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "report_pending_review" }),
    );
  });

  it("approves a report into the settlement pool without creating settlement items", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "report_pending_review",
    });

    const report = await reviewLiveReport({
      repo,
      audit,
      notify,
      actor,
      reportId: "report-1",
      input: {
        decision: "approve",
        includeInTaskResult: true,
        enterSettlementPool: true,
        reviewNotes: "ok",
      },
    });

    expect(report).toMatchObject({
      status: "approved",
      enterSettlementPool: true,
    });
    expect(repo.updateLiveTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "completed" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approve", module: "live_report" }),
    );
    expect("createSettlementBatchItem" in repo).toBe(false);
  });

  it("keeps rejected and needs-more reports out of task results and settlement", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "report_pending_review",
    });

    const rejected = await reviewLiveReport({
      repo,
      audit,
      notify,
      actor,
      reportId: "report-1",
      input: {
        decision: "reject",
        includeInTaskResult: true,
        enterSettlementPool: true,
        reviewNotes: "bad evidence",
      },
    });

    expect(rejected).toMatchObject({
      status: "rejected",
      includeInTaskResult: false,
      enterSettlementPool: false,
    });
    expect(repo.updateLiveReport).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        includeInTaskResult: false,
        enterSettlementPool: false,
      }),
    );

    vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
      id: "report-2",
      organizationId: "org-1",
      liveTaskId: "task-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "pending_review",
      systemDuration: 120,
      screenshotDuration: 120,
      claimedDuration: 120,
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
      divergencePct: 0,
      viewers: 800,
      includeInTaskResult: true,
      enterSettlementPool: true,
      riskFlags: [],
    });
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "report_pending_review",
    });

    await reviewLiveReport({
      repo,
      audit,
      notify,
      actor,
      reportId: "report-2",
      input: {
        decision: "need_more",
        includeInTaskResult: true,
        enterSettlementPool: true,
        reviewNotes: "need another screenshot",
      },
    });

    expect(repo.updateLiveReport).toHaveBeenLastCalledWith(
      "report-2",
      expect.objectContaining({
        status: "need_more",
        includeInTaskResult: false,
        enterSettlementPool: false,
      }),
    );
  });

  it("blocks cross-organization report reviews even if the repository returns a row", async () => {
    vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
      id: "report-2",
      organizationId: "org-2",
      liveTaskId: "task-2",
      projectId: "project-2",
      streamerId: "streamer-2",
      status: "pending_review",
      systemDuration: 120,
      screenshotDuration: 120,
      claimedDuration: 120,
      settlementDuration: 120,
      timeSource: "system",
      evidenceLevel: "green",
      divergencePct: 0,
      viewers: 800,
      includeInTaskResult: true,
      enterSettlementPool: true,
      riskFlags: [],
    });

    await expect(
      reviewLiveReport({
        repo,
        audit,
        notify,
        actor,
        reportId: "report-2",
        input: {
          decision: "approve",
          includeInTaskResult: true,
          enterSettlementPool: true,
          reviewNotes: "ok",
        },
      }),
    ).rejects.toThrow("Cross-organization access is not allowed");

    expect(repo.updateLiveReport).not.toHaveBeenCalled();
    expect(repo.createReportChangeLog).not.toHaveBeenCalled();
  });
});
