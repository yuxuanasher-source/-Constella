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
  it("aggregates broadcast rate, revenue and viewers over the window", () => {
    const metrics = computeStreamerPerformance(
      [
        {
          taskId: "t1",
          status: "completed",
          plannedStartAt: "2026-07-01T12:00:00Z",
          systemStartedAt: "2026-07-01T12:00:00Z",
          systemDuration: 120,
          settlementDuration: 120,
          viewers: 3000,
          projectHourlyRate: 100,
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
        },
      ],
      50,
    );

    expect(metrics.scheduledSessions).toBe(2);
    expect(metrics.liveSessions).toBe(1);
    expect(metrics.completedSessions).toBe(1);
    expect(metrics.broadcastRateBps).toBe(5000);
    expect(metrics.totalLiveMinutes).toBe(120);
    expect(metrics.totalRevenueAmount).toBe(200);
    expect(metrics.avgSessionRevenueAmount).toBe(200);
    // 成本 = 2h × 50 = 100，ROI = 200 / 100 = 2x = 20000bps
    expect(metrics.avgSessionRoiBps).toBe(20000);
    expect(metrics.totalViewers).toBe(3000);
    expect(metrics.avgSessionViewers).toBe(3000);
  });

  it("falls back to system duration and null ROI without a talent rate", () => {
    const metrics = computeStreamerPerformance(
      [
        {
          taskId: "t1",
          status: "completed",
          plannedStartAt: "2026-07-01T12:00:00Z",
          systemStartedAt: "2026-07-01T12:00:00Z",
          systemDuration: 60,
          settlementDuration: null,
          viewers: null,
          projectHourlyRate: null,
        },
      ],
      null,
    );

    expect(metrics.totalLiveMinutes).toBe(60);
    expect(metrics.totalRevenueAmount).toBe(0);
    expect(metrics.avgSessionRoiBps).toBeNull();
  });

  it("returns zeroed metrics for an empty window", () => {
    const metrics = computeStreamerPerformance([], 50);
    expect(metrics.scheduledSessions).toBe(0);
    expect(metrics.broadcastRateBps).toBe(0);
    expect(metrics.avgSessionRevenueAmount).toBe(0);
    expect(metrics.avgSessionRoiBps).toBeNull();
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
