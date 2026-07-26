import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelLiveTask,
  confirmLiveReportOcrResult,
  createLiveTask,
  reviewLiveReport,
  startLiveTask,
  stopLiveTask,
  submitLiveReport,
  submitLiveReportScreenshotForOcr,
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

const partnerOpsActor = {
  userId: "user-partner-ops",
  name: "Partner Ops",
  role: "operator_business" as const,
  organizationId: "org-partner",
};

const partnerStreamerActor = {
  userId: "user-partner-streamer",
  name: "Partner Streamer",
  role: "streamer" as const,
  organizationId: "org-partner",
  streamerId: "streamer-1",
};

const ocrInput = {
  screenshotStoragePath: "org/report-screenshots/task-1/end.png",
  screenshotFileHash: "hash-1",
  imageBucket: "evidence-private",
};
const databaseScreenshotId = "00000000-0000-4000-8000-000000000101";

const task = {
  id: "task-1",
  organizationId: "org-1",
  projectId: "project-1",
  streamerId: "streamer-1",
  title: "Project A · Streamer 1",
  taskType: "project" as const,
  status: "pending_live" as const,
  plannedStartAt: "2026-06-02T10:00:00.000Z",
  plannedEndAt: "2026-06-02T12:00:00.000Z",
  plannedDuration: 120,
  requiresTiming: true,
  systemStartedAt: null,
  systemStoppedAt: null,
  systemDuration: 0,
};

const baseReport = {
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
};

function createRepo(): LiveOperationsRepository {
  return {
    getProjectStreamer: vi.fn(async () => ({
      id: "project-streamer-1",
      projectId: "project-1",
      streamerId: "streamer-1",
      status: "joined" as const,
    })),
    getActiveCollaborationAgreement: vi.fn(async () => null),
    createLiveTask: vi.fn(async (input) => ({
      ...task,
      id: "task-created",
      organizationId: input.organizationId,
      projectId: input.projectId,
      streamerId: input.streamerId,
      title: input.title,
      taskType: input.taskType,
      plannedStartAt: input.plannedStartAt,
      plannedEndAt: input.plannedEndAt,
      plannedDuration: input.plannedDuration,
      createdBy: input.createdBy,
      collaborationId: input.collaborationId,
      contributorOrganizationId: input.contributorOrganizationId,
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
      status: input.status,
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
      collaborationId: input.collaborationId,
      contributorOrganizationId: input.contributorOrganizationId,
    })),
    getLiveReportById: vi.fn(async () => ({ ...baseReport })),
    listLiveReportsByTask: vi.fn(async () => []),
    updateLiveReport: vi.fn(async (_reportId, patch) => ({
      ...baseReport,
      ...patch,
    })),
    createReportScreenshot: vi.fn(async () => databaseScreenshotId),
    createReportChangeLog: vi.fn(async () => undefined),
  };
}

function createQueuedOcrJob() {
  return vi.fn(async () => ({
    id: "ocr-job-1",
    organizationId: "org-1",
    jobType: "ocr.extract_live_report",
    status: "queued",
    attempt: 0,
    payload: {
      liveReportId: "report-1",
      imagePath: "org/report-screenshots/task-1/end.png",
    },
  }));
}

describe("live operations service", () => {
  let repo: LiveOperationsRepository;
  const audit = vi.fn(async () => undefined);
  const notify = vi.fn(async () => undefined);
  const deleteReportScreenshot = vi.fn(async () => undefined);

  beforeEach(() => {
    repo = createRepo();
    audit.mockClear();
    notify.mockClear();
    deleteReportScreenshot.mockReset();
    deleteReportScreenshot.mockResolvedValue(undefined);
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

  it("persists the selected live task type", async () => {
    await createLiveTask({
      repo,
      audit,
      notify,
      actor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        title: "Project A · Streamer 1",
        taskType: "training",
        plannedStartAt: "2026-06-02T10:00:00.000Z",
        plannedEndAt: "2026-06-02T12:00:00.000Z",
        plannedDuration: 120,
      },
    });

    expect(repo.createLiveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "training",
      }),
    );
  });

  it("validates active collaboration before creating an attributed task", async () => {
    vi.mocked(repo.getActiveCollaborationAgreement).mockResolvedValueOnce({
      id: "agreement-1",
      projectId: "project-1",
      partnerOrganizationId: "org-partner",
      status: "active",
    });

    await createLiveTask({
      repo,
      audit,
      notify,
      actor: partnerOpsActor,
      input: {
        projectId: "project-1",
        streamerId: "streamer-1",
        title: "Partner project task",
        collaborationId: "agreement-1",
        plannedStartAt: "2026-06-02T10:00:00.000Z",
        plannedEndAt: "2026-06-02T12:00:00.000Z",
        plannedDuration: 120,
      },
    });

    expect(repo.getActiveCollaborationAgreement).toHaveBeenCalledWith({
      projectId: "project-1",
      collaborationId: "agreement-1",
      contributorOrganizationId: "org-partner",
    });
    expect(repo.createLiveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborationId: "agreement-1",
        contributorOrganizationId: "org-partner",
      }),
    );
  });

  it("rejects live task collaboration attribution without an active agreement", async () => {
    await expect(
      createLiveTask({
        repo,
        audit,
        notify,
        actor: partnerOpsActor,
        input: {
          projectId: "project-1",
          streamerId: "streamer-1",
          title: "Partner project task",
          collaborationId: "agreement-1",
          plannedStartAt: "2026-06-02T10:00:00.000Z",
          plannedEndAt: "2026-06-02T12:00:00.000Z",
          plannedDuration: 120,
        },
      }),
    ).rejects.toThrow("Active collaboration agreement is required");

    expect(repo.createLiveTask).not.toHaveBeenCalled();
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

  it("inherits collaboration attribution when submitting a report", async () => {
    vi.mocked(repo.getActiveCollaborationAgreement).mockResolvedValueOnce({
      id: "agreement-1",
      projectId: "project-1",
      partnerOrganizationId: "org-partner",
      status: "active",
    });
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      organizationId: "org-partner",
      status: "pending_report",
      systemStartedAt: "2026-06-02T10:00:00.000Z",
      systemStoppedAt: "2026-06-02T12:00:00.000Z",
      systemDuration: 120,
      collaborationId: "agreement-1",
      contributorOrganizationId: "org-partner",
    });

    await submitLiveReport({
      repo,
      audit,
      notify,
      actor: partnerStreamerActor,
      taskId: "task-1",
      input: {
        screenshotStoragePath: "private/reports/task-1/end.png",
        screenshotFileHash: "hash-1",
        screenshotDuration: 122,
        claimedDuration: 122,
        viewers: 952,
      },
    });

    expect(repo.createLiveReport).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborationId: "agreement-1",
        contributorOrganizationId: "org-partner",
      }),
    );
  });

  it("queues OCR when a streamer submits a live report screenshot for OCR", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "pending_report",
      systemStartedAt: "2026-06-02T10:00:00.000Z",
      systemStoppedAt: "2026-06-02T11:20:00.000Z",
      systemDuration: 80,
    });
    const createOcrJob = createQueuedOcrJob();

    const result = await submitLiveReportScreenshotForOcr({
      repo,
      audit,
      notify,
      actor: streamerActor,
      taskId: "task-1",
      input: ocrInput,
      createOcrJob,
      deleteReportScreenshot,
    });

    expect(result.report.status).toBe("ocr_ing");
    expect(result.job.id).toBe("ocr-job-1");
    expect(repo.createLiveReport).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ocr_ing",
        settlementDuration: 80,
        timeSource: "system",
        evidenceLevel: "yellow",
        riskFlags: expect.arrayContaining([
          "missing_screenshot_duration",
          "ocr_pending",
        ]),
      }),
    );
    expect(repo.createReportScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({
        storagePath: "org/report-screenshots/task-1/end.png",
        fileHash: "hash-1",
        uploadedBy: "user-streamer",
        metadata: { imageBucket: "evidence-private" },
      }),
    );
    expect(createOcrJob).toHaveBeenCalledWith(
      expect.objectContaining({
        liveReportId: "report-1",
        screenshotId: databaseScreenshotId,
        imageBucket: "evidence-private",
        imagePath: "org/report-screenshots/task-1/end.png",
        expectedDuration: 80,
      }),
    );
    expect(repo.updateLiveTask).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "live_task",
        objectId: "task-1",
        changedFields: ["status"],
      }),
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain(
      "org/report-screenshots",
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain("hash-1");
    expect(JSON.stringify(notify.mock.calls)).not.toContain(
      "org/report-screenshots",
    );
    expect(JSON.stringify(notify.mock.calls)).not.toContain("hash-1");
  });

  it("queues OCR from a rejected report retry path", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "report_rejected",
      systemStartedAt: "2026-06-02T10:00:00.000Z",
      systemStoppedAt: "2026-06-02T11:20:00.000Z",
      systemDuration: 80,
    });
    const createOcrJob = createQueuedOcrJob();

    const result = await submitLiveReportScreenshotForOcr({
      repo,
      audit,
      notify,
      actor: streamerActor,
      taskId: "task-1",
      input: ocrInput,
      createOcrJob,
      deleteReportScreenshot,
    });

    expect(result.report.status).toBe("ocr_ing");
    expect(createOcrJob).toHaveBeenCalledWith(
      expect.objectContaining({
        liveReportId: "report-1",
        expectedDuration: 80,
      }),
    );
    expect(repo.updateLiveTask).not.toHaveBeenCalled();
  });

  it("blocks OCR submission from another streamer's task", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "pending_report",
      systemDuration: 80,
    });
    const createOcrJob = vi.fn(async () => ({
      id: "ocr-job-1",
      status: "queued",
    }));

    await expect(
      submitLiveReportScreenshotForOcr({
        repo,
        audit,
        notify,
        actor: { ...streamerActor, streamerId: "streamer-2" },
        taskId: "task-1",
        input: ocrInput,
        createOcrJob,
        deleteReportScreenshot,
      }),
    ).rejects.toThrow("Streamers can only operate their own live tasks");

    expect(repo.createLiveReport).not.toHaveBeenCalled();
    expect(repo.createReportScreenshot).not.toHaveBeenCalled();
    expect(createOcrJob).not.toHaveBeenCalled();
  });

  it("rejects OCR submission for invalid task status before report or job creation", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "live",
      systemDuration: 80,
    });
    const createOcrJob = createQueuedOcrJob();

    await expect(
      submitLiveReportScreenshotForOcr({
        repo,
        audit,
        notify,
        actor: streamerActor,
        taskId: "task-1",
        input: ocrInput,
        createOcrJob,
        deleteReportScreenshot,
      }),
    ).rejects.toThrow(
      "OCR reports can only be submitted from pending or rejected report tasks",
    );

    expect(repo.createLiveReport).not.toHaveBeenCalled();
    expect(repo.createReportScreenshot).not.toHaveBeenCalled();
    expect(repo.updateLiveTask).not.toHaveBeenCalled();
    expect(createOcrJob).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", 0],
    ["missing", undefined],
  ])(
    "rejects OCR submission with %s system duration before report or job creation",
    async (_case, systemDuration) => {
      vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
        ...task,
        status: "pending_report",
        systemDuration: systemDuration as number,
      });
      const createOcrJob = createQueuedOcrJob();

      await expect(
        submitLiveReportScreenshotForOcr({
          repo,
          audit,
          notify,
          actor: streamerActor,
          taskId: "task-1",
          input: ocrInput,
          createOcrJob,
          deleteReportScreenshot,
        }),
      ).rejects.toThrow("OCR report requires a recorded system duration");

      expect(repo.createLiveReport).not.toHaveBeenCalled();
      expect(repo.createReportScreenshot).not.toHaveBeenCalled();
      expect(repo.updateLiveTask).not.toHaveBeenCalled();
      expect(createOcrJob).not.toHaveBeenCalled();
    },
  );

  it("blocks cross-organization OCR submission before report or job creation", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      organizationId: "org-2",
      status: "pending_report",
      systemDuration: 80,
    });
    const createOcrJob = createQueuedOcrJob();

    await expect(
      submitLiveReportScreenshotForOcr({
        repo,
        audit,
        notify,
        actor: streamerActor,
        taskId: "task-1",
        input: ocrInput,
        createOcrJob,
        deleteReportScreenshot,
      }),
    ).rejects.toThrow("Cross-organization access is not allowed");

    expect(repo.createLiveReport).not.toHaveBeenCalled();
    expect(repo.createReportScreenshot).not.toHaveBeenCalled();
    expect(repo.updateLiveTask).not.toHaveBeenCalled();
    expect(createOcrJob).not.toHaveBeenCalled();
  });

  it("blocks unexpected non-streamer roles from OCR submission before report or job creation", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "pending_report",
      systemDuration: 80,
    });
    const createOcrJob = createQueuedOcrJob();

    await expect(
      submitLiveReportScreenshotForOcr({
        repo,
        audit,
        notify,
        actor: {
          ...streamerActor,
          role: "guest" as typeof streamerActor.role,
        },
        taskId: "task-1",
        input: ocrInput,
        createOcrJob,
        deleteReportScreenshot,
      }),
    ).rejects.toThrow("Current role cannot operate live tasks");

    expect(repo.createLiveReport).not.toHaveBeenCalled();
    expect(repo.createReportScreenshot).not.toHaveBeenCalled();
    expect(repo.updateLiveTask).not.toHaveBeenCalled();
    expect(createOcrJob).not.toHaveBeenCalled();
  });

  it("voids the report and does not advance the task when OCR queueing fails", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "pending_report",
      systemDuration: 80,
    });
    const createOcrJob = vi.fn(async () => {
      throw new Error("queue unavailable");
    });

    await expect(
      submitLiveReportScreenshotForOcr({
        repo,
        audit,
        notify,
        actor: streamerActor,
        taskId: "task-1",
        input: ocrInput,
        createOcrJob,
        deleteReportScreenshot,
      }),
    ).rejects.toMatchObject({
      message: "OCR 入队失败，请稍后重试",
    });

    // The report is created but then voided, and the task is never advanced
    // into review (so the streamer can simply re-upload).
    expect(repo.createLiveReport).toHaveBeenCalled();
    expect(repo.updateLiveReport).toHaveBeenCalledWith("report-1", {
      status: "voided",
    });
    expect(deleteReportScreenshot).toHaveBeenCalledWith({
      id: databaseScreenshotId,
      organizationId: "org-1",
      liveReportId: "report-1",
      screenshotFileHash: "hash-1",
    });
    expect(repo.updateLiveTask).not.toHaveBeenCalledWith("task-1", {
      status: "report_pending_review",
    });
  });

  it.each([
    ["screenshot insert fails", new Error("insert denied")],
    ["screenshot RETURNING fails", new Error("returning failed")],
  ])(
    "voids the report and skips OCR queueing when %s",
    async (_case, screenshotError) => {
      vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
        ...task,
        status: "pending_report",
        systemDuration: 80,
      });
      vi.mocked(repo.createReportScreenshot).mockRejectedValueOnce(
        screenshotError,
      );
      const createOcrJob = createQueuedOcrJob();

      await expect(
        submitLiveReportScreenshotForOcr({
          repo,
          audit,
          notify,
          actor: streamerActor,
          taskId: "task-1",
          input: ocrInput,
          createOcrJob,
          deleteReportScreenshot,
        }),
      ).rejects.toMatchObject({
        message: "OCR 入队失败，请稍后重试",
      });

      expect(repo.updateLiveReport).toHaveBeenCalledWith("report-1", {
        status: "voided",
      });
      expect(deleteReportScreenshot).toHaveBeenCalledWith({
        id: undefined,
        organizationId: "org-1",
        liveReportId: "report-1",
        screenshotFileHash: "hash-1",
      });
      expect(createOcrJob).not.toHaveBeenCalled();
      expect(repo.updateLiveTask).not.toHaveBeenCalledWith("task-1", {
        status: "report_pending_review",
      });
    },
  );

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["non-string", 42],
    ["non-UUID", "screenshot-db-1"],
  ])(
    "voids the report and skips OCR queueing for a %s screenshot id",
    async (_case, screenshotId) => {
      vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
        ...task,
        status: "pending_report",
        systemDuration: 80,
      });
      vi.mocked(repo.createReportScreenshot).mockResolvedValueOnce(
        screenshotId as never,
      );
      const createOcrJob = createQueuedOcrJob();

      await expect(
        submitLiveReportScreenshotForOcr({
          repo,
          audit,
          notify,
          actor: streamerActor,
          taskId: "task-1",
          input: ocrInput,
          createOcrJob,
          deleteReportScreenshot,
        }),
      ).rejects.toMatchObject({
        message: "OCR 入队失败，请稍后重试",
      });

      expect(repo.updateLiveReport).toHaveBeenCalledWith("report-1", {
        status: "voided",
      });
      expect(deleteReportScreenshot).toHaveBeenCalledWith({
        id: undefined,
        organizationId: "org-1",
        liveReportId: "report-1",
        screenshotFileHash: "hash-1",
      });
      expect(createOcrJob).not.toHaveBeenCalled();
      expect(repo.updateLiveTask).not.toHaveBeenCalledWith("task-1", {
        status: "report_pending_review",
      });
    },
  );

  it("still voids the report and returns a stable error when screenshot cleanup fails", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "pending_report",
      systemDuration: 80,
    });
    deleteReportScreenshot.mockRejectedValueOnce(new Error("cleanup denied"));
    const createOcrJob = vi.fn(async () => {
      throw new Error("queue unavailable");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      submitLiveReportScreenshotForOcr({
        repo,
        audit,
        notify,
        actor: streamerActor,
        taskId: "task-1",
        input: ocrInput,
        createOcrJob,
        deleteReportScreenshot,
      }),
    ).rejects.toMatchObject({
      message: "OCR 入队失败，请稍后重试",
    });

    expect(deleteReportScreenshot).toHaveBeenCalledWith({
      id: databaseScreenshotId,
      organizationId: "org-1",
      liveReportId: "report-1",
      screenshotFileHash: "hash-1",
    });
    expect(repo.updateLiveReport).toHaveBeenCalledWith("report-1", {
      status: "voided",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[live-operations] failed to clean up OCR screenshot",
      {
        organizationId: "org-1",
        liveReportId: "report-1",
        screenshotId: databaseScreenshotId,
        screenshotFileHash: "hash-1",
      },
    );
    consoleError.mockRestore();
  });

  it("can retry the same screenshot after a failed OCR enqueue", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValue({
      ...task,
      status: "pending_report",
      systemDuration: 80,
    });
    let screenshotRowExists = false;
    vi.mocked(repo.createReportScreenshot).mockImplementation(async () => {
      if (screenshotRowExists) {
        throw new Error("duplicate file hash");
      }
      screenshotRowExists = true;
      return databaseScreenshotId;
    });
    deleteReportScreenshot.mockImplementation(async () => {
      screenshotRowExists = false;
    });
    const firstQueueAttempt = vi.fn(async () => {
      throw new Error("queue unavailable");
    });

    await expect(
      submitLiveReportScreenshotForOcr({
        repo,
        audit,
        notify,
        actor: streamerActor,
        taskId: "task-1",
        input: ocrInput,
        createOcrJob: firstQueueAttempt,
        deleteReportScreenshot,
      }),
    ).rejects.toThrow("OCR 入队失败，请稍后重试");

    const result = await submitLiveReportScreenshotForOcr({
      repo,
      audit,
      notify,
      actor: streamerActor,
      taskId: "task-1",
      input: ocrInput,
      createOcrJob: createQueuedOcrJob(),
      deleteReportScreenshot,
    });

    expect(result.job.id).toBe("ocr-job-1");
    expect(deleteReportScreenshot).toHaveBeenCalledOnce();
    expect(repo.createReportScreenshot).toHaveBeenCalledTimes(2);
  });

  it.each(["rejected", "need_more"])(
    "leaves prior %s report archival to the atomic enqueue transaction",
    async (priorStatus) => {
      vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
        ...task,
        status: "report_rejected",
        systemDuration: 80,
      });
      vi.mocked(repo.listLiveReportsByTask).mockResolvedValueOnce([
        {
          ...baseReport,
          id: "old-report",
          status: priorStatus as "rejected" | "need_more",
        },
      ]);
      const createOcrJob = vi.fn(async () => ({
        id: "job-1",
        status: "queued",
      }));

      await submitLiveReportScreenshotForOcr({
        repo,
        audit,
        notify,
        actor: streamerActor,
        taskId: "task-1",
        input: ocrInput,
        createOcrJob,
        deleteReportScreenshot,
      });

      expect(repo.updateLiveReport).not.toHaveBeenCalledWith("old-report", {
        status: "voided",
      });
      expect(repo.createLiveReport).toHaveBeenCalled();
      expect(repo.updateLiveTask).not.toHaveBeenCalled();
    },
  );

  it("preserves a prior rejected report when its replacement cannot be queued", async () => {
    vi.mocked(repo.getLiveTaskById).mockResolvedValueOnce({
      ...task,
      status: "report_rejected",
      systemDuration: 80,
    });
    vi.mocked(repo.listLiveReportsByTask).mockResolvedValueOnce([
      { ...baseReport, id: "old-report", status: "rejected" },
    ]);

    await expect(
      submitLiveReportScreenshotForOcr({
        repo,
        audit,
        notify,
        actor: streamerActor,
        taskId: "task-1",
        input: ocrInput,
        createOcrJob: vi.fn(async () => {
          throw new Error("task already claimed");
        }),
        deleteReportScreenshot,
      }),
    ).rejects.toThrow("OCR 入队失败，请稍后重试");

    expect(repo.updateLiveReport).not.toHaveBeenCalledWith("old-report", {
      status: "voided",
    });
    expect(repo.updateLiveReport).toHaveBeenCalledWith("report-1", {
      status: "voided",
    });
  });

  it("confirmLiveReportOcrResult confirms OCR result values and sends the report to review", async () => {
    vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
      ...baseReport,
      status: "ocr_ing",
      streamerId: "streamer-1",
      organizationId: "org-1",
      systemDuration: 120,
    });

    const result = await confirmLiveReportOcrResult({
      repo,
      audit,
      notify,
      actor: streamerActor,
      reportId: "report-1",
      input: {
        ocrDuration: 78,
        ocrViewers: 300,
        confirmedDuration: 80,
        confirmedViewers: 320,
      },
    });

    expect(result.status).toBe("pending_review");
    expect(repo.updateLiveReport).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        status: "pending_review",
        screenshotDuration: 78,
        claimedDuration: 80,
        settlementDuration: 120,
        timeSource: "system",
        evidenceLevel: "yellow",
        viewers: 320,
        riskFlags: expect.arrayContaining(["duration_divergence"]),
      }),
    );
    expect(repo.createReportChangeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        liveReportId: "report-1",
        changedFields: expect.arrayContaining([
          "status",
          "screenshot_duration",
          "claimed_duration",
          "settlement_duration",
          "time_source",
          "evidence_level",
          "divergence_pct",
          "viewers",
          "risk_flags",
        ]),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "live_report",
        objectId: "report-1",
        changedFields: expect.arrayContaining([
          "status",
          "screenshot_duration",
          "claimed_duration",
          "settlement_duration",
          "time_source",
          "evidence_level",
          "divergence_pct",
          "viewers",
          "risk_flags",
        ]),
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientRole: "operator_business",
        title: "Live report values confirmed",
        content: "A streamer confirmed OCR report values.",
        source: "live_report.ocr.confirm",
      }),
    );
  });

  it("blocks another streamer from confirming an OCR report before side effects", async () => {
    vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
      ...baseReport,
      status: "ocr_ing",
    });

    await expect(
      confirmLiveReportOcrResult({
        repo,
        audit,
        notify,
        actor: { ...streamerActor, streamerId: "streamer-2" },
        reportId: "report-1",
        input: {
          ocrDuration: 78,
          confirmedDuration: 80,
        },
      }),
    ).rejects.toThrow("Streamers can only confirm their own reports");

    expect(repo.updateLiveReport).not.toHaveBeenCalled();
    expect(repo.createReportChangeLog).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("blocks finance from confirming OCR reports before side effects", async () => {
    vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
      ...baseReport,
      status: "ocr_ing",
      organizationId: "org-1",
    });

    await expect(
      confirmLiveReportOcrResult({
        repo,
        audit,
        notify,
        actor: {
          userId: "user-finance",
          name: "Finance",
          role: "finance",
          organizationId: "org-1",
        },
        reportId: "report-1",
        input: {
          ocrDuration: 78,
          confirmedDuration: 80,
        },
      }),
    ).rejects.toThrow("Current role cannot review live reports");

    expect(repo.updateLiveReport).not.toHaveBeenCalled();
    expect(repo.updateLiveTask).not.toHaveBeenCalled();
    expect(repo.createReportChangeLog).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects non-OCR reports before confirmation side effects", async () => {
    vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
      ...baseReport,
      status: "approved",
    });

    await expect(
      confirmLiveReportOcrResult({
        repo,
        audit,
        notify,
        actor: streamerActor,
        reportId: "report-1",
        input: {
          ocrDuration: 78,
          confirmedDuration: 80,
        },
      }),
    ).rejects.toThrow("Only OCR pending reports can be confirmed");

    expect(repo.updateLiveReport).not.toHaveBeenCalled();
    expect(repo.createReportChangeLog).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("lets same-organization staff confirm an OCR report", async () => {
    vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
      ...baseReport,
      status: "pending_confirm",
    });

    const result = await confirmLiveReportOcrResult({
      repo,
      audit,
      notify,
      actor,
      reportId: "report-1",
      input: {
        ocrDuration: 118,
        confirmedDuration: 119,
        confirmedViewers: 410,
      },
    });

    expect(result.status).toBe("pending_review");
    expect(repo.updateLiveReport).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        status: "pending_review",
        viewers: 410,
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Live report values confirmed",
        content: "A staff member confirmed OCR report values.",
      }),
    );
  });

  it("falls back to OCR viewers when confirmed viewers are omitted", async () => {
    vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
      ...baseReport,
      status: "pending_confirm",
      viewers: 800,
    });

    await confirmLiveReportOcrResult({
      repo,
      audit,
      notify,
      actor: streamerActor,
      reportId: "report-1",
      input: {
        ocrDuration: 80,
        ocrViewers: 305,
        confirmedDuration: 80,
      },
    });

    expect(repo.updateLiveReport).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        viewers: 305,
      }),
    );
  });

  it("moves need-more confirmation tasks back to pending review so approval can complete", async () => {
    vi.mocked(repo.getLiveReportById)
      .mockResolvedValueOnce({
        ...baseReport,
        status: "need_more",
        viewers: 800,
      })
      .mockResolvedValueOnce({
        ...baseReport,
        status: "pending_review",
        screenshotDuration: 80,
        claimedDuration: 80,
        settlementDuration: 120,
        viewers: 305,
      });
    vi.mocked(repo.getLiveTaskById)
      .mockResolvedValueOnce({
        ...task,
        status: "report_rejected",
      })
      .mockResolvedValueOnce({
        ...task,
        status: "report_pending_review",
      });

    await confirmLiveReportOcrResult({
      repo,
      audit,
      notify,
      actor: streamerActor,
      reportId: "report-1",
      input: {
        ocrDuration: 80,
        ocrViewers: 305,
        confirmedDuration: 80,
      },
    });

    expect(repo.updateLiveTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "report_pending_review" }),
    );

    await reviewLiveReport({
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

    expect(repo.updateLiveTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it.each([
    ["confirmedViewers", { confirmedViewers: -1 }],
    ["ocrViewers", { ocrViewers: -1 }],
  ])(
    "rejects negative %s before confirmation side effects",
    async (_field, viewerInput) => {
      vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
        ...baseReport,
        status: "ocr_ing",
      });

      await expect(
        confirmLiveReportOcrResult({
          repo,
          audit,
          notify,
          actor: streamerActor,
          reportId: "report-1",
          input: {
            ocrDuration: 80,
            confirmedDuration: 80,
            ...viewerInput,
          },
        }),
      ).rejects.toThrow("Viewer count must be a non-negative number");

      expect(repo.updateLiveReport).not.toHaveBeenCalled();
      expect(repo.updateLiveTask).not.toHaveBeenCalled();
      expect(repo.createReportChangeLog).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    },
  );

  it("keeps existing viewers when confirmed and OCR viewers are omitted", async () => {
    vi.mocked(repo.getLiveReportById).mockResolvedValueOnce({
      ...baseReport,
      status: "ocr_ing",
      viewers: 800,
    });

    await confirmLiveReportOcrResult({
      repo,
      audit,
      notify,
      actor: streamerActor,
      reportId: "report-1",
      input: {
        ocrDuration: 80,
        confirmedDuration: 80,
      },
    });

    expect(repo.updateLiveReport).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        viewers: 800,
      }),
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
