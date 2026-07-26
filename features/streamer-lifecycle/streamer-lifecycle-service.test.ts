import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyStreamerOperationTier,
  cancelShiftChangeRequest,
  changeStreamerLifecycleStage,
  concludeStreamerAssessment,
  createShiftChangeRequest,
  createStreamerAssessment,
  generateAttendanceRecords,
  recordManualAttendance,
  reviewShiftChangeRequest,
  syncStreamerPerformance,
  updateStreamerContract,
  updateStreamerRating,
  type StreamerLifecycleAuditWriter,
  type StreamerLifecycleNotifier,
  type StreamerLifecycleRecord,
  type StreamerLifecycleRepository,
} from "./streamer-lifecycle-service";

const opsActor = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
};

const operatorActor = {
  ...opsActor,
  userId: "user-op",
  role: "operator_business" as const,
};
const financeActor = {
  ...opsActor,
  userId: "user-fin",
  role: "finance" as const,
};
const streamerActor = {
  ...opsActor,
  userId: "user-streamer",
  role: "streamer" as const,
  streamerId: "streamer-1",
};

const baseStreamer: StreamerLifecycleRecord = {
  id: "streamer-1",
  displayName: "小星",
  userId: "user-streamer",
  riskLevel: "low",
  lifecycleStage: "trial",
  rating: "unrated",
  contractStartDate: null,
  contractEndDate: null,
  revenueShareBps: null,
  operationTier: "unassigned",
  operationTags: [],
  defaultHourlyRate: 50,
};

const basePendingRequest = {
  id: "req-1",
  liveTaskId: "task-1",
  projectId: "project-1",
  streamerId: "streamer-1",
  requestType: "reschedule" as const,
  proposedStartAt: "2026-07-05T12:00:00.000Z",
  proposedEndAt: "2026-07-05T16:00:00.000Z",
  substituteStreamerId: null,
  reason: "临时有事",
  status: "pending" as const,
  reviewNote: null,
};

const basePendingTask = {
  id: "task-1",
  organizationId: "org-1",
  projectId: "project-1",
  streamerId: "streamer-1",
  status: "pending_live",
  plannedStartAt: "2026-07-04T12:00:00.000Z",
  plannedEndAt: "2026-07-04T16:00:00.000Z",
};

function makeRepo(): StreamerLifecycleRepository {
  return {
    getStreamerLifecycle: vi.fn().mockResolvedValue({ ...baseStreamer }),
    updateStreamerLifecycle: vi
      .fn()
      .mockImplementation(
        async (_id: string, patch: Record<string, unknown>) => ({
          ...baseStreamer,
          lifecycleStage:
            (patch.lifecycle_stage as StreamerLifecycleRecord["lifecycleStage"]) ??
            baseStreamer.lifecycleStage,
          rating:
            (patch.rating as StreamerLifecycleRecord["rating"]) ??
            baseStreamer.rating,
          contractStartDate:
            (patch.contract_start_date as string | null | undefined) !==
            undefined
              ? (patch.contract_start_date as string | null)
              : baseStreamer.contractStartDate,
          contractEndDate:
            (patch.contract_end_date as string | null | undefined) !== undefined
              ? (patch.contract_end_date as string | null)
              : baseStreamer.contractEndDate,
          revenueShareBps:
            (patch.revenue_share_bps as number | null | undefined) !== undefined
              ? (patch.revenue_share_bps as number | null)
              : baseStreamer.revenueShareBps,
          operationTier:
            (patch.operation_tier as string | undefined) ??
            baseStreamer.operationTier,
          operationTags:
            (patch.operation_tags as string[] | undefined) ??
            baseStreamer.operationTags,
        }),
      ),
    insertLifecycleEvent: vi.fn().mockResolvedValue(undefined),
    createAssessment: vi.fn().mockResolvedValue({
      id: "assessment-1",
      streamerId: "streamer-1",
      projectId: null,
      liveTaskId: null,
      assessmentType: "trial",
      title: "首场试播",
      status: "pending",
      score: null,
      conclusion: "",
      scheduledAt: null,
      concludedAt: null,
    }),
    getAssessmentById: vi.fn().mockResolvedValue({
      id: "assessment-1",
      streamerId: "streamer-1",
      projectId: null,
      liveTaskId: null,
      assessmentType: "trial",
      title: "首场试播",
      status: "pending",
      score: null,
      conclusion: "",
      scheduledAt: null,
      concludedAt: null,
    }),
    concludeAssessment: vi.fn().mockImplementation(async (_id, patch) => ({
      id: "assessment-1",
      streamerId: "streamer-1",
      projectId: null,
      liveTaskId: null,
      assessmentType: "trial",
      title: "首场试播",
      status: patch.status,
      score: patch.score ?? null,
      conclusion: patch.conclusion ?? "",
      scheduledAt: null,
      concludedAt: patch.concluded_at,
    })),
    listAttendanceCandidateTasks: vi.fn().mockResolvedValue([]),
    insertAttendanceRecords: vi
      .fn()
      .mockImplementation(async (records) => records.length),
    upsertManualAttendance: vi.fn().mockResolvedValue(undefined),
    getLiveTaskById: vi.fn().mockResolvedValue({ ...basePendingTask }),
    getProjectStreamerStatus: vi.fn().mockResolvedValue("joined"),
    createShiftChangeRequest: vi
      .fn()
      .mockResolvedValue({ ...basePendingRequest }),
    getShiftChangeRequestById: vi
      .fn()
      .mockResolvedValue({ ...basePendingRequest }),
    updateShiftChangeRequest: vi
      .fn()
      .mockImplementation(async (_id, patch) => ({
        ...basePendingRequest,
        status: patch.status,
        reviewNote: patch.review_note ?? null,
      })),
    updateLiveTaskSchedule: vi.fn().mockResolvedValue(undefined),
    listPerformanceSourceTasks: vi.fn().mockResolvedValue([]),
    upsertPerformanceSnapshot: vi.fn().mockImplementation(async (input) => ({
      id: "snapshot-1",
      streamerId: input.streamerId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      scheduledSessions: input.metrics.scheduled_sessions,
      liveSessions: input.metrics.live_sessions,
      completedSessions: input.metrics.completed_sessions,
      broadcastRateBps: input.metrics.broadcast_rate_bps,
      totalLiveMinutes: input.metrics.total_live_minutes,
      avgSessionMinutes: input.metrics.avg_session_minutes,
      totalRevenueAmount: input.metrics.total_revenue_amount,
      avgSessionRevenueAmount: input.metrics.avg_session_revenue_amount,
      totalSettlementAmount: input.metrics.total_settlement_amount,
      actualHourlyRate: input.metrics.actual_hourly_rate,
      totalGmvAmount: input.metrics.total_gmv_amount,
      roiBps: input.metrics.roi_bps,
      viewsPerHour: input.metrics.views_per_hour,
      totalViewers: input.metrics.total_viewers,
      avgSessionViewers: input.metrics.avg_session_viewers,
      computedAt: "2026-07-03T00:00:00.000Z",
    })),
    getLatestPerformanceSnapshot: vi.fn().mockResolvedValue({
      id: "snapshot-1",
      streamerId: "streamer-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      scheduledSessions: 20,
      liveSessions: 19,
      completedSessions: 18,
      broadcastRateBps: 9500,
      totalLiveMinutes: 4560,
      avgSessionMinutes: 240,
      totalRevenueAmount: 30000,
      avgSessionRevenueAmount: 1578.95,
      totalSettlementAmount: 20000,
      actualHourlyRate: 263.16,
      totalGmvAmount: 30000,
      roiBps: 15000,
      viewsPerHour: 789.47,
      totalViewers: 60000,
      avgSessionViewers: 3157,
      computedAt: "2026-07-01T00:00:00.000Z",
    }),
  };
}

let repo: StreamerLifecycleRepository;
let audit: StreamerLifecycleAuditWriter;
let notify: StreamerLifecycleNotifier;

beforeEach(() => {
  repo = makeRepo();
  audit = vi.fn(async () => undefined);
  notify = vi.fn(async () => undefined);
});

describe("changeStreamerLifecycleStage", () => {
  it("moves the stage, records an event, audits and notifies the streamer", async () => {
    const streamer = await changeStreamerLifecycleStage({
      repo,
      audit,
      notify,
      actor: opsActor,
      streamerId: "streamer-1",
      input: { stage: "training" },
      reason: "试播通过，进入培训",
    });

    expect(streamer.lifecycleStage).toBe("training");
    expect(repo.updateStreamerLifecycle).toHaveBeenCalledWith(
      "streamer-1",
      expect.objectContaining({ lifecycle_stage: "training" }),
    );
    expect(repo.insertLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stage_change",
        fromValue: "trial",
        toValue: "training",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        module: "streamer_lifecycle",
        changedFields: ["lifecycle_stage"],
        isHighRisk: false,
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "user-streamer" }),
    );
  });

  it("marks elimination as a high-risk audit", async () => {
    await changeStreamerLifecycleStage({
      repo,
      audit,
      actor: opsActor,
      streamerId: "streamer-1",
      input: { stage: "eliminated" },
      reason: "长期未出勤",
    });

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ isHighRisk: true }),
    );
  });

  it("rejects operators, missing reasons and illegal transitions", async () => {
    await expect(
      changeStreamerLifecycleStage({
        repo,
        audit,
        actor: operatorActor,
        streamerId: "streamer-1",
        input: { stage: "training" },
        reason: "x",
      }),
    ).rejects.toThrow(
      "Only owner and ops_manager can change streamer lifecycle stage",
    );

    await expect(
      changeStreamerLifecycleStage({
        repo,
        audit,
        actor: opsActor,
        streamerId: "streamer-1",
        input: { stage: "training" },
        reason: "  ",
      }),
    ).rejects.toThrow("Streamer lifecycle stage changes require a reason");

    vi.mocked(repo.getStreamerLifecycle).mockResolvedValue({
      ...baseStreamer,
      lifecycleStage: "eliminated",
    });
    await expect(
      changeStreamerLifecycleStage({
        repo,
        audit,
        actor: opsActor,
        streamerId: "streamer-1",
        input: { stage: "regular" },
        reason: "复播",
      }),
    ).rejects.toThrow(
      "Lifecycle stage cannot change from eliminated to regular",
    );
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("updateStreamerRating", () => {
  it("updates the rating with an event and audit", async () => {
    const streamer = await updateStreamerRating({
      repo,
      audit,
      actor: opsActor,
      streamerId: "streamer-1",
      input: { rating: "a" },
      reason: "月度评级",
    });

    expect(streamer.rating).toBe("a");
    expect(repo.insertLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "rating_change",
        fromValue: "unrated",
        toValue: "a",
      }),
    );
  });

  it("rejects non-governing roles", async () => {
    await expect(
      updateStreamerRating({
        repo,
        audit,
        actor: operatorActor,
        streamerId: "streamer-1",
        input: { rating: "s" },
        reason: "x",
      }),
    ).rejects.toThrow("Only owner and ops_manager can update streamer rating");
  });
});

describe("updateStreamerContract", () => {
  it("stores the contract window and share with a high-risk audit", async () => {
    const streamer = await updateStreamerContract({
      repo,
      audit,
      actor: opsActor,
      streamerId: "streamer-1",
      input: {
        contractStartDate: "2026-07-01",
        contractEndDate: "2027-06-30",
        revenueShareBps: 5500,
      },
      reason: "签约一年",
    });

    expect(streamer.contractEndDate).toBe("2027-06-30");
    expect(streamer.revenueShareBps).toBe(5500);
    expect(repo.insertLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "contract_change" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ isHighRisk: true }),
    );
  });

  it("validates share bounds and date order", async () => {
    await expect(
      updateStreamerContract({
        repo,
        audit,
        actor: opsActor,
        streamerId: "streamer-1",
        input: { revenueShareBps: 10001 },
        reason: "x",
      }),
    ).rejects.toThrow("revenueShareBps must be between 0 and 10000");

    await expect(
      updateStreamerContract({
        repo,
        audit,
        actor: opsActor,
        streamerId: "streamer-1",
        input: {
          contractStartDate: "2026-07-01",
          contractEndDate: "2026-06-30",
        },
        reason: "x",
      }),
    ).rejects.toThrow(
      "contractEndDate cannot be earlier than contractStartDate",
    );

    await expect(
      updateStreamerContract({
        repo,
        audit,
        actor: opsActor,
        streamerId: "streamer-1",
        input: {},
        reason: "x",
      }),
    ).rejects.toThrow("No streamer contract changes provided");
  });
});

describe("streamer assessments", () => {
  it("creates an assessment for staff", async () => {
    const assessment = await createStreamerAssessment({
      repo,
      audit,
      actor: operatorActor,
      streamerId: "streamer-1",
      input: { assessmentType: "trial", title: "首场试播" },
    });

    expect(assessment.id).toBe("assessment-1");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "create",
        objectType: "streamer_assessment",
      }),
    );
  });

  it("rejects finance and eliminated streamers", async () => {
    await expect(
      createStreamerAssessment({
        repo,
        audit,
        actor: financeActor,
        streamerId: "streamer-1",
        input: { assessmentType: "trial", title: "x" },
      }),
    ).rejects.toThrow("Current role cannot manage streamer assessments");

    vi.mocked(repo.getStreamerLifecycle).mockResolvedValue({
      ...baseStreamer,
      lifecycleStage: "eliminated",
    });
    await expect(
      createStreamerAssessment({
        repo,
        audit,
        actor: opsActor,
        streamerId: "streamer-1",
        input: { assessmentType: "trial", title: "x" },
      }),
    ).rejects.toThrow("Eliminated streamers cannot be assessed");
  });

  it("concludes an assessment and notifies the streamer", async () => {
    const concluded = await concludeStreamerAssessment({
      repo,
      audit,
      notify,
      actor: operatorActor,
      assessmentId: "assessment-1",
      input: { result: "passed", score: 88, conclusion: "镜头感好" },
    });

    expect(concluded.status).toBe("passed");
    expect(repo.insertLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "assessment_concluded",
        toValue: "passed",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approve" }),
    );
    expect(notify).toHaveBeenCalled();
    // 非转正考核不触发转正。
    expect(repo.updateStreamerLifecycle).not.toHaveBeenCalled();
  });

  it("promotes trial streamers to regular when probation passes", async () => {
    vi.mocked(repo.getAssessmentById).mockResolvedValue({
      id: "assessment-2",
      streamerId: "streamer-1",
      projectId: null,
      liveTaskId: null,
      assessmentType: "probation",
      title: "转正评估",
      status: "pending",
      score: null,
      conclusion: "",
      scheduledAt: null,
      concludedAt: null,
    });

    await concludeStreamerAssessment({
      repo,
      audit,
      actor: opsActor,
      assessmentId: "assessment-2",
      input: { result: "passed", score: 90 },
    });

    expect(repo.updateStreamerLifecycle).toHaveBeenCalledWith(
      "streamer-1",
      expect.objectContaining({ lifecycle_stage: "regular" }),
    );
    expect(repo.insertLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stage_change",
        toValue: "regular",
        reason: "转正评估通过",
      }),
    );
  });

  it("restricts probation conclusions to owner and ops_manager", async () => {
    vi.mocked(repo.getAssessmentById).mockResolvedValue({
      id: "assessment-2",
      streamerId: "streamer-1",
      projectId: null,
      liveTaskId: null,
      assessmentType: "probation",
      title: "转正评估",
      status: "pending",
      score: null,
      conclusion: "",
      scheduledAt: null,
      concludedAt: null,
    });

    await expect(
      concludeStreamerAssessment({
        repo,
        audit,
        actor: operatorActor,
        assessmentId: "assessment-2",
        input: { result: "passed" },
      }),
    ).rejects.toThrow(
      "Only owner and ops_manager can conclude probation assessments",
    );
  });

  it("refuses double conclusion and bad scores", async () => {
    vi.mocked(repo.getAssessmentById).mockResolvedValue({
      id: "assessment-1",
      streamerId: "streamer-1",
      projectId: null,
      liveTaskId: null,
      assessmentType: "trial",
      title: "首场试播",
      status: "passed",
      score: 90,
      conclusion: "",
      scheduledAt: null,
      concludedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(
      concludeStreamerAssessment({
        repo,
        audit,
        actor: opsActor,
        assessmentId: "assessment-1",
        input: { result: "failed" },
      }),
    ).rejects.toThrow("Assessment is already concluded");

    await expect(
      concludeStreamerAssessment({
        repo,
        audit,
        actor: opsActor,
        assessmentId: "assessment-1",
        input: { result: "passed", score: 101 },
      }),
    ).rejects.toThrow("score must be between 0 and 100");
  });
});

describe("generateAttendanceRecords", () => {
  it("derives late and absent records from finished tasks", async () => {
    vi.mocked(repo.listAttendanceCandidateTasks).mockResolvedValue([
      {
        taskId: "task-late",
        streamerId: "streamer-1",
        projectId: "project-1",
        status: "completed",
        plannedStartAt: "2026-07-01T12:00:00.000Z",
        plannedEndAt: "2026-07-01T16:00:00.000Z",
        systemStartedAt: "2026-07-01T12:30:00.000Z",
        systemStoppedAt: "2026-07-01T16:00:00.000Z",
        systemDuration: 210,
      },
      {
        taskId: "task-absent",
        streamerId: "streamer-2",
        projectId: "project-1",
        status: "pending_live",
        plannedStartAt: "2026-07-01T12:00:00.000Z",
        plannedEndAt: "2026-07-01T16:00:00.000Z",
        systemStartedAt: null,
        systemStoppedAt: null,
        systemDuration: 0,
      },
      {
        taskId: "task-upcoming",
        streamerId: "streamer-3",
        projectId: null,
        status: "pending_live",
        plannedStartAt: "2026-07-09T12:00:00.000Z",
        plannedEndAt: "2026-07-09T16:00:00.000Z",
        systemStartedAt: null,
        systemStoppedAt: null,
        systemDuration: 0,
      },
    ]);

    const result = await generateAttendanceRecords({
      repo,
      audit,
      actor: operatorActor,
      input: { until: "2026-07-02T00:00:00.000Z" },
    });

    expect(result).toEqual({ generated: 2, scanned: 3 });
    expect(repo.insertAttendanceRecords).toHaveBeenCalledWith([
      expect.objectContaining({
        liveTaskId: "task-late",
        attendanceStatus: "late",
        lateMinutes: 30,
        source: "auto",
      }),
      expect.objectContaining({
        liveTaskId: "task-absent",
        attendanceStatus: "absent",
      }),
    ]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ objectType: "streamer_attendance" }),
    );
  });

  it("skips the audit when nothing is generated and rejects finance", async () => {
    const result = await generateAttendanceRecords({
      repo,
      audit,
      actor: opsActor,
    });
    expect(result).toEqual({ generated: 0, scanned: 0 });
    expect(audit).not.toHaveBeenCalled();

    await expect(
      generateAttendanceRecords({ repo, audit, actor: financeActor }),
    ).rejects.toThrow("Current role cannot manage streamer attendance");
  });
});

describe("recordManualAttendance", () => {
  it("stores a manual correction with a reason", async () => {
    await recordManualAttendance({
      repo,
      audit,
      actor: opsActor,
      input: { liveTaskId: "task-1", attendanceStatus: "leave", note: "病假" },
      reason: "主播提前请假",
    });

    expect(repo.upsertManualAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        liveTaskId: "task-1",
        attendanceStatus: "leave",
        source: "manual",
        note: "病假",
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "主播提前请假" }),
    );
  });

  it("requires a reason and an in-org task", async () => {
    await expect(
      recordManualAttendance({
        repo,
        audit,
        actor: opsActor,
        input: { liveTaskId: "task-1", attendanceStatus: "leave" },
        reason: " ",
      }),
    ).rejects.toThrow("Manual attendance corrections require a reason");

    vi.mocked(repo.getLiveTaskById).mockResolvedValue({
      ...basePendingTask,
      organizationId: "org-other",
    });
    await expect(
      recordManualAttendance({
        repo,
        audit,
        actor: opsActor,
        input: { liveTaskId: "task-1", attendanceStatus: "leave" },
        reason: "x",
      }),
    ).rejects.toThrow("Live task not found");
  });
});

describe("createShiftChangeRequest", () => {
  it("lets a streamer file a reschedule request for their own task", async () => {
    const request = await createShiftChangeRequest({
      repo,
      audit,
      notify,
      actor: streamerActor,
      input: {
        liveTaskId: "task-1",
        requestType: "reschedule",
        proposedStartAt: "2026-07-05T12:00:00.000Z",
        proposedEndAt: "2026-07-05T16:00:00.000Z",
        reason: "临时有事",
      },
    });

    expect(request.status).toBe("pending");
    expect(repo.createShiftChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: "reschedule",
        streamerId: "streamer-1",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientRole: "ops_manager" }),
    );
  });

  it("blocks requests for other streamers' tasks and non-pending tasks", async () => {
    await expect(
      createShiftChangeRequest({
        repo,
        audit,
        actor: { ...streamerActor, streamerId: "streamer-9" },
        input: {
          liveTaskId: "task-1",
          requestType: "reschedule",
          proposedStartAt: "2026-07-05T12:00:00.000Z",
          proposedEndAt: "2026-07-05T16:00:00.000Z",
          reason: "x",
        },
      }),
    ).rejects.toThrow(
      "Streamers can only request shift changes for their own tasks",
    );

    vi.mocked(repo.getLiveTaskById).mockResolvedValue({
      ...basePendingTask,
      status: "live",
    });
    await expect(
      createShiftChangeRequest({
        repo,
        audit,
        actor: streamerActor,
        input: {
          liveTaskId: "task-1",
          requestType: "reschedule",
          proposedStartAt: "2026-07-05T12:00:00.000Z",
          proposedEndAt: "2026-07-05T16:00:00.000Z",
          reason: "x",
        },
      }),
    ).rejects.toThrow("Only pending live tasks can request a shift change");
  });

  it("validates the proposed window and substitute eligibility", async () => {
    await expect(
      createShiftChangeRequest({
        repo,
        audit,
        actor: streamerActor,
        input: {
          liveTaskId: "task-1",
          requestType: "reschedule",
          proposedStartAt: "2026-07-05T16:00:00.000Z",
          proposedEndAt: "2026-07-05T12:00:00.000Z",
          reason: "x",
        },
      }),
    ).rejects.toThrow("proposedEndAt must be later than proposedStartAt");

    vi.mocked(repo.getStreamerLifecycle).mockResolvedValue({
      ...baseStreamer,
      id: "streamer-2",
      riskLevel: "blacklisted",
    });
    await expect(
      createShiftChangeRequest({
        repo,
        audit,
        actor: opsActor,
        input: {
          liveTaskId: "task-1",
          requestType: "substitute",
          substituteStreamerId: "streamer-2",
          reason: "x",
        },
      }),
    ).rejects.toThrow("Blacklisted streamers cannot take substitute shifts");

    vi.mocked(repo.getStreamerLifecycle).mockResolvedValue({
      ...baseStreamer,
      id: "streamer-2",
    });
    vi.mocked(repo.getProjectStreamerStatus).mockResolvedValue("candidate");
    await expect(
      createShiftChangeRequest({
        repo,
        audit,
        actor: opsActor,
        input: {
          liveTaskId: "task-1",
          requestType: "substitute",
          substituteStreamerId: "streamer-2",
          reason: "x",
        },
      }),
    ).rejects.toThrow("Substitute streamer has not joined the project");
  });
});

describe("reviewShiftChangeRequest", () => {
  it("applies an approved reschedule to the live task", async () => {
    const reviewed = await reviewShiftChangeRequest({
      repo,
      audit,
      notify,
      actor: opsActor,
      requestId: "req-1",
      input: { decision: "approved", reviewNote: "同意" },
    });

    expect(reviewed.status).toBe("approved");
    expect(repo.updateLiveTaskSchedule).toHaveBeenCalledWith("task-1", {
      planned_start_at: "2026-07-05T12:00:00.000Z",
      planned_end_at: "2026-07-05T16:00:00.000Z",
      planned_duration: 240,
    });
    expect(repo.insertLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "shift_change_applied" }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approve" }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "user-streamer" }),
    );
  });

  it("reassigns the task on an approved substitution", async () => {
    vi.mocked(repo.getShiftChangeRequestById).mockResolvedValue({
      ...basePendingRequest,
      requestType: "substitute",
      proposedStartAt: null,
      proposedEndAt: null,
      substituteStreamerId: "streamer-2",
    });

    await reviewShiftChangeRequest({
      repo,
      audit,
      actor: opsActor,
      requestId: "req-1",
      input: { decision: "approved" },
    });

    expect(repo.updateLiveTaskSchedule).toHaveBeenCalledWith("task-1", {
      streamer_id: "streamer-2",
    });
  });

  it("rejects without touching the task", async () => {
    const reviewed = await reviewShiftChangeRequest({
      repo,
      audit,
      actor: operatorActor,
      requestId: "req-1",
      input: { decision: "rejected", reviewNote: "排期冲突" },
    });

    expect(reviewed.status).toBe("rejected");
    expect(repo.updateLiveTaskSchedule).not.toHaveBeenCalled();
    expect(repo.insertLifecycleEvent).not.toHaveBeenCalled();
  });

  it("refuses finance, settled requests and stale tasks", async () => {
    await expect(
      reviewShiftChangeRequest({
        repo,
        audit,
        actor: financeActor,
        requestId: "req-1",
        input: { decision: "approved" },
      }),
    ).rejects.toThrow("Current role cannot review shift change requests");

    vi.mocked(repo.getShiftChangeRequestById).mockResolvedValue({
      ...basePendingRequest,
      status: "approved",
    });
    await expect(
      reviewShiftChangeRequest({
        repo,
        audit,
        actor: opsActor,
        requestId: "req-1",
        input: { decision: "rejected" },
      }),
    ).rejects.toThrow(
      "Shift change request cannot change from approved to rejected",
    );

    vi.mocked(repo.getShiftChangeRequestById).mockResolvedValue({
      ...basePendingRequest,
    });
    vi.mocked(repo.getLiveTaskById).mockResolvedValue({
      ...basePendingTask,
      status: "live",
    });
    await expect(
      reviewShiftChangeRequest({
        repo,
        audit,
        actor: opsActor,
        requestId: "req-1",
        input: { decision: "approved" },
      }),
    ).rejects.toThrow("Live task is no longer pending live");
  });
});

describe("cancelShiftChangeRequest", () => {
  it("lets the requesting streamer cancel a pending request", async () => {
    const cancelled = await cancelShiftChangeRequest({
      repo,
      audit,
      actor: streamerActor,
      requestId: "req-1",
    });

    expect(cancelled.status).toBe("cancelled");
  });

  it("blocks other streamers", async () => {
    await expect(
      cancelShiftChangeRequest({
        repo,
        audit,
        actor: { ...streamerActor, streamerId: "streamer-9" },
        requestId: "req-1",
      }),
    ).rejects.toThrow("Streamers can only cancel their own requests");
  });
});

describe("syncStreamerPerformance", () => {
  it("aggregates tasks into an upserted snapshot", async () => {
    vi.mocked(repo.listPerformanceSourceTasks).mockResolvedValue([
      {
        taskId: "t1",
        status: "completed",
        plannedStartAt: "2026-06-05T12:00:00Z",
        systemStartedAt: "2026-06-05T12:00:00Z",
        systemDuration: 120,
        settlementDuration: 120,
        viewers: 2000,
        projectHourlyRate: 100,
        settlementItems: [{ id: "item-t1", amount: 150 }],
        attributedGmvAmount: 300,
      },
      {
        taskId: "t2",
        status: "pending_live",
        plannedStartAt: "2026-06-06T12:00:00Z",
        systemStartedAt: null,
        systemDuration: 0,
        settlementDuration: null,
        viewers: null,
        projectHourlyRate: 100,
        settlementItems: null,
        attributedGmvAmount: null,
      },
    ]);

    const snapshot = await syncStreamerPerformance({
      repo,
      audit,
      actor: operatorActor,
      streamerId: "streamer-1",
      input: { periodStart: "2026-06-01", periodEnd: "2026-06-30" },
    });

    expect(repo.upsertPerformanceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        metrics: expect.objectContaining({
          scheduled_sessions: 2,
          live_sessions: 1,
          broadcast_rate_bps: 5000,
          avg_session_minutes: 120,
          total_revenue_amount: 200,
          avg_session_revenue_amount: 200,
          total_settlement_amount: 150,
          actual_hourly_rate: 75,
          total_gmv_amount: 300,
          roi_bps: 20000,
          views_per_hour: 1000,
        }),
      }),
    );
    expect(snapshot.broadcastRateBps).toBe(5000);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        objectType: "streamer_performance_snapshot",
      }),
    );
  });

  it("validates period boundaries and roles", async () => {
    await expect(
      syncStreamerPerformance({
        repo,
        audit,
        actor: opsActor,
        streamerId: "streamer-1",
        input: { periodStart: "2026-06-30", periodEnd: "2026-06-01" },
      }),
    ).rejects.toThrow("periodEnd cannot be earlier than periodStart");

    await expect(
      syncStreamerPerformance({
        repo,
        audit,
        actor: opsActor,
        streamerId: "streamer-1",
        input: { periodStart: "06/01/2026", periodEnd: "2026-06-30" },
      }),
    ).rejects.toThrow("periodStart must be a valid date (YYYY-MM-DD)");

    await expect(
      syncStreamerPerformance({
        repo,
        audit,
        actor: financeActor,
        streamerId: "streamer-1",
        input: { periodStart: "2026-06-01", periodEnd: "2026-06-30" },
      }),
    ).rejects.toThrow("Current role cannot sync streamer performance");
  });
});

describe("applyStreamerOperationTier", () => {
  it("writes the resolved tier and tags back to the streamer", async () => {
    const { streamer, plan } = await applyStreamerOperationTier({
      repo,
      audit,
      actor: opsActor,
      streamerId: "streamer-1",
    });

    expect(plan.tier).toBe("core");
    expect(streamer.operationTier).toBe("core");
    expect(repo.updateStreamerLifecycle).toHaveBeenCalledWith(
      "streamer-1",
      expect.objectContaining({
        operation_tier: "core",
        operation_tags: expect.arrayContaining(["核心主播"]),
      }),
    );
    expect(repo.insertLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "tier_change",
        toValue: "core",
      }),
    );
  });

  it("requires a snapshot and a governing role", async () => {
    vi.mocked(repo.getLatestPerformanceSnapshot).mockResolvedValue(null);
    await expect(
      applyStreamerOperationTier({
        repo,
        audit,
        actor: opsActor,
        streamerId: "streamer-1",
      }),
    ).rejects.toThrow(
      "No performance snapshot available; sync streamer performance first",
    );

    await expect(
      applyStreamerOperationTier({
        repo,
        audit,
        actor: operatorActor,
        streamerId: "streamer-1",
      }),
    ).rejects.toThrow(
      "Only owner and ops_manager can adjust streamer operation tiers",
    );
  });
});
