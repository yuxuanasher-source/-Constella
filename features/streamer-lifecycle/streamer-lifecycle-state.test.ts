import { describe, expect, it } from "vitest";

import {
  assertLifecycleStageTransition,
  assertShiftChangeTransition,
  computeStreamerPerformance,
  deriveAttendanceFromTask,
  resolveOperationTier,
  type AttendanceCandidateTask,
} from "./streamer-lifecycle-state";

const baseTask: AttendanceCandidateTask = {
  taskId: "task-1",
  streamerId: "streamer-1",
  projectId: "project-1",
  status: "completed",
  plannedStartAt: "2026-07-01T12:00:00.000Z",
  plannedEndAt: "2026-07-01T16:00:00.000Z",
  systemStartedAt: "2026-07-01T12:02:00.000Z",
  systemStoppedAt: "2026-07-01T15:58:00.000Z",
  systemDuration: 236,
};

describe("lifecycle stage transitions", () => {
  it("allows the recruit -> trial -> training -> regular path", () => {
    expect(() =>
      assertLifecycleStageTransition("recruited", "trial"),
    ).not.toThrow();
    expect(() =>
      assertLifecycleStageTransition("trial", "training"),
    ).not.toThrow();
    expect(() =>
      assertLifecycleStageTransition("training", "regular"),
    ).not.toThrow();
  });

  it("blocks regressions and resurrection of eliminated streamers", () => {
    expect(() => assertLifecycleStageTransition("regular", "trial")).toThrow(
      "Lifecycle stage cannot change from regular to trial",
    );
    expect(() =>
      assertLifecycleStageTransition("eliminated", "regular"),
    ).toThrow("Lifecycle stage cannot change from eliminated to regular");
  });
});

describe("deriveAttendanceFromTask", () => {
  const now = new Date("2026-07-02T00:00:00.000Z");

  it("marks small delays as on_time within the grace window", () => {
    expect(deriveAttendanceFromTask(baseTask, now)).toEqual({
      attendanceStatus: "on_time",
      lateMinutes: 2,
      liveMinutes: 236,
    });
  });

  it("marks starts beyond the grace window as late", () => {
    const derived = deriveAttendanceFromTask(
      { ...baseTask, systemStartedAt: "2026-07-01T12:20:00.000Z" },
      now,
    );
    expect(derived).toEqual({
      attendanceStatus: "late",
      lateMinutes: 20,
      liveMinutes: 236,
    });
  });

  it("marks never-started tasks as absent once the planned end has passed", () => {
    const derived = deriveAttendanceFromTask(
      { ...baseTask, systemStartedAt: null, systemStoppedAt: null },
      now,
    );
    expect(derived).toEqual({
      attendanceStatus: "absent",
      lateMinutes: 0,
      liveMinutes: 0,
    });
  });

  it("returns null when the verdict is not yet decidable", () => {
    expect(
      deriveAttendanceFromTask({ ...baseTask, plannedStartAt: null }, now),
    ).toBeNull();
    expect(
      deriveAttendanceFromTask({ ...baseTask, status: "cancelled" }, now),
    ).toBeNull();
    expect(
      deriveAttendanceFromTask(
        {
          ...baseTask,
          systemStartedAt: null,
          plannedEndAt: "2026-07-05T16:00:00.000Z",
        },
        now,
      ),
    ).toBeNull();
  });
});

describe("shift change transitions", () => {
  it("only allows leaving the pending state", () => {
    expect(() =>
      assertShiftChangeTransition("pending", "approved"),
    ).not.toThrow();
    expect(() =>
      assertShiftChangeTransition("pending", "cancelled"),
    ).not.toThrow();
    expect(() => assertShiftChangeTransition("approved", "rejected")).toThrow(
      "Shift change request cannot change from approved to rejected",
    );
  });
});

describe("computeStreamerPerformance", () => {
  it("aggregates average session minutes and real economics over the window", () => {
    const metrics = computeStreamerPerformance([
      {
        taskId: "t1",
        status: "completed",
        plannedStartAt: "2026-07-01T12:00:00Z",
        systemStartedAt: "2026-07-01T12:00:00Z",
        systemDuration: 120,
        settlementDuration: 120,
        viewers: 3000,
        projectHourlyRate: 100,
        settlementItems: [{ id: "item-t1", amount: 150 }],
        attributedGmvAmount: 300,
      },
      {
        taskId: "t2",
        status: "pending_live",
        plannedStartAt: "2026-07-02T12:00:00Z",
        systemStartedAt: null,
        systemDuration: 0,
        settlementDuration: null,
        viewers: null,
        projectHourlyRate: 100,
        settlementItems: null,
        attributedGmvAmount: null,
      },
      {
        taskId: "t3",
        status: "cancelled",
        plannedStartAt: "2026-07-03T12:00:00Z",
        systemStartedAt: null,
        systemDuration: 0,
        settlementDuration: null,
        viewers: null,
        projectHourlyRate: 100,
        settlementItems: null,
        attributedGmvAmount: null,
      },
    ]);

    expect(metrics.scheduledSessions).toBe(2);
    expect(metrics.liveSessions).toBe(1);
    expect(metrics.completedSessions).toBe(1);
    expect(metrics.broadcastRateBps).toBe(5000);
    expect(metrics.totalLiveMinutes).toBe(120);
    expect(metrics.avgSessionMinutes).toBe(120);
    expect(metrics.totalRevenueAmount).toBe(200);
    expect(metrics.avgSessionRevenueAmount).toBe(200);
    expect(metrics.totalSettlementAmount).toBe(150);
    expect(metrics.actualHourlyRate).toBe(75);
    expect(metrics.totalGmvAmount).toBe(300);
    expect(metrics.roiBps).toBe(20000);
    expect(metrics.viewsPerHour).toBe(1500);
    expect(metrics.totalViewers).toBe(3000);
    expect(metrics.avgSessionViewers).toBe(3000);
  });

  it("weights actual hourly rate by total duration across projects", () => {
    const metrics = computeStreamerPerformance([
      {
        taskId: "t1",
        status: "completed",
        plannedStartAt: "2026-07-01T12:00:00Z",
        systemStartedAt: "2026-07-01T12:00:00Z",
        systemDuration: 60,
        settlementDuration: null,
        viewers: 600,
        projectHourlyRate: null,
        settlementItems: [{ id: "item-t1", amount: 100 }],
        attributedGmvAmount: 200,
      },
      {
        taskId: "t2",
        status: "completed",
        plannedStartAt: "2026-07-02T12:00:00Z",
        systemStartedAt: "2026-07-02T12:00:00Z",
        systemDuration: 120,
        settlementDuration: 120,
        viewers: 2400,
        projectHourlyRate: 999,
        settlementItems: [{ id: "item-t2", amount: 100 }],
        attributedGmvAmount: 400,
      },
    ]);

    expect(metrics.totalLiveMinutes).toBe(180);
    expect(metrics.avgSessionMinutes).toBe(90);
    expect(metrics.totalSettlementAmount).toBe(200);
    expect(metrics.actualHourlyRate).toBe(66.67);
    expect(metrics.totalGmvAmount).toBe(600);
    expect(metrics.roiBps).toBe(30000);
    expect(metrics.viewsPerHour).toBe(1000);
  });

  it("keeps real economics unavailable when any live session lacks attribution", () => {
    const metrics = computeStreamerPerformance([
      {
        taskId: "t1",
        status: "completed",
        plannedStartAt: "2026-07-01T12:00:00Z",
        systemStartedAt: "2026-07-01T12:00:00Z",
        systemDuration: 60,
        settlementDuration: 60,
        viewers: null,
        projectHourlyRate: 100,
        settlementItems: null,
        attributedGmvAmount: null,
      },
    ]);

    expect(metrics.totalSettlementAmount).toBeNull();
    expect(metrics.actualHourlyRate).toBeNull();
    expect(metrics.totalGmvAmount).toBeNull();
    expect(metrics.roiBps).toBeNull();
    expect(metrics.viewsPerHour).toBeNull();
  });

  it("preserves observed zero GMV and settlement amounts", () => {
    const baseTask = {
      taskId: "t1",
      status: "completed",
      plannedStartAt: "2026-07-01T12:00:00Z",
      systemStartedAt: "2026-07-01T12:00:00Z",
      systemDuration: 60,
      settlementDuration: 60,
      viewers: 0,
      projectHourlyRate: null,
    };

    const zeroGmv = computeStreamerPerformance([
      {
        ...baseTask,
        settlementItems: [{ id: "item-zero-gmv", amount: 100 }],
        attributedGmvAmount: 0,
      },
    ]);
    expect(zeroGmv.totalGmvAmount).toBe(0);
    expect(zeroGmv.roiBps).toBe(0);
    expect(zeroGmv.viewsPerHour).toBe(0);

    const zeroSettlement = computeStreamerPerformance([
      {
        ...baseTask,
        settlementItems: [{ id: "item-zero-cost", amount: 0 }],
        attributedGmvAmount: 100,
      },
    ]);
    expect(zeroSettlement.totalSettlementAmount).toBe(0);
    expect(zeroSettlement.actualHourlyRate).toBe(0);
    expect(zeroSettlement.roiBps).toBeNull();
  });

  it("dedupes one aggregate settlement item linked to multiple live tasks", () => {
    const sharedItem = [{ id: "item-shared", amount: 100 }];
    const metrics = computeStreamerPerformance([
      {
        taskId: "t1",
        status: "completed",
        plannedStartAt: "2026-07-01T12:00:00Z",
        systemStartedAt: "2026-07-01T12:00:00Z",
        systemDuration: 60,
        settlementDuration: 60,
        viewers: 1000,
        projectHourlyRate: null,
        settlementItems: sharedItem,
        attributedGmvAmount: 200,
      },
      {
        taskId: "t2",
        status: "completed",
        plannedStartAt: "2026-07-02T12:00:00Z",
        systemStartedAt: "2026-07-02T12:00:00Z",
        systemDuration: 60,
        settlementDuration: 60,
        viewers: 1000,
        projectHourlyRate: null,
        settlementItems: sharedItem,
        attributedGmvAmount: 100,
      },
    ]);

    expect(metrics.totalSettlementAmount).toBe(100);
    expect(metrics.actualHourlyRate).toBe(50);
    expect(metrics.roiBps).toBe(30000);
  });

  it("returns zeroed metrics for an empty window", () => {
    const metrics = computeStreamerPerformance([]);
    expect(metrics.scheduledSessions).toBe(0);
    expect(metrics.broadcastRateBps).toBe(0);
    expect(metrics.avgSessionMinutes).toBe(0);
    expect(metrics.avgSessionRevenueAmount).toBe(0);
    expect(metrics.actualHourlyRate).toBeNull();
    expect(metrics.roiBps).toBeNull();
    expect(metrics.viewsPerHour).toBeNull();
  });
});

describe("resolveOperationTier", () => {
  it("promotes high broadcast rate and revenue streamers to core", () => {
    const plan = resolveOperationTier({
      broadcastRateBps: 9500,
      liveSessions: 20,
      avgSessionRevenueAmount: 1500,
    });
    expect(plan.tier).toBe("core");
    expect(plan.tags).toContain("核心主播");
    expect(plan.tags).toContain("高开播率");
    expect(plan.suggestedShareBps).toBe(7000);
  });

  it("flags rising streamers as potential", () => {
    const plan = resolveOperationTier({
      broadcastRateBps: 8500,
      liveSessions: 8,
      avgSessionRevenueAmount: 600,
    });
    expect(plan.tier).toBe("potential");
    expect(plan.suggestedShareBps).toBe(6000);
  });

  it("puts low broadcast rate streamers on the observation list", () => {
    const plan = resolveOperationTier({
      broadcastRateBps: 4000,
      liveSessions: 10,
      avgSessionRevenueAmount: 800,
    });
    expect(plan.tier).toBe("observation");
    expect(plan.tags).toContain("低开播率");
    expect(plan.suggestedShareBps).toBe(4000);
  });

  it("defaults steady streamers to the regular tier", () => {
    const plan = resolveOperationTier({
      broadcastRateBps: 7000,
      liveSessions: 6,
      avgSessionRevenueAmount: 300,
    });
    expect(plan.tier).toBe("regular");
    expect(plan.suggestedShareBps).toBe(5000);
  });
});
