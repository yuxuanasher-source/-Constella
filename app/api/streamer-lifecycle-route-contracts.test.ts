import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as concludeAssessmentPost } from "./streamer-assessments/[assessmentId]/conclude/route";
import { POST as generateAttendancePost } from "./streamer-attendance/generate/route";
import { POST as manualAttendancePost } from "./streamer-attendance/manual/route";
import { POST as createShiftChangeRequestPost } from "./shift-change-requests/route";
import { POST as cancelShiftChangeRequestPost } from "./shift-change-requests/[requestId]/cancel/route";
import { POST as reviewShiftChangeRequestPost } from "./shift-change-requests/[requestId]/review/route";
import { POST as createAssessmentPost } from "./streamers/[streamerId]/assessments/route";
import { PATCH as contractPatch } from "./streamers/[streamerId]/contract/route";
import { PATCH as lifecyclePatch } from "./streamers/[streamerId]/lifecycle/route";
import { POST as operationTierPost } from "./streamers/[streamerId]/operation-tier/route";
import { POST as performanceSyncPost } from "./streamers/[streamerId]/performance/sync/route";
import { PATCH as ratingPatch } from "./streamers/[streamerId]/rating/route";

import { assertBillingWriteAllowed } from "@/features/billing/route-guard";
import {
  actorFromContext,
  getStreamerLifecycleRouteContext,
} from "@/features/streamer-lifecycle/streamer-lifecycle-route-utils";
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
} from "@/features/streamer-lifecycle/streamer-lifecycle-service";

vi.mock(
  "@/features/streamer-lifecycle/streamer-lifecycle-route-utils",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/features/streamer-lifecycle/streamer-lifecycle-route-utils")
    >("@/features/streamer-lifecycle/streamer-lifecycle-route-utils");

    return {
      ...actual,
      actorFromContext: vi.fn(),
      getStreamerLifecycleRouteContext: vi.fn(),
    };
  },
);

vi.mock("@/features/streamer-lifecycle/streamer-lifecycle-service", () => ({
  applyStreamerOperationTier: vi.fn(),
  cancelShiftChangeRequest: vi.fn(),
  changeStreamerLifecycleStage: vi.fn(),
  concludeStreamerAssessment: vi.fn(),
  createShiftChangeRequest: vi.fn(),
  createStreamerAssessment: vi.fn(),
  generateAttendanceRecords: vi.fn(),
  recordManualAttendance: vi.fn(),
  reviewShiftChangeRequest: vi.fn(),
  syncStreamerPerformance: vi.fn(),
  updateStreamerContract: vi.fn(),
  updateStreamerRating: vi.fn(),
}));

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));

const supabase = { client: "supabase" };

const opsActor = {
  userId: "user-ops",
  name: "Ops",
  role: "ops_manager" as const,
  organizationId: "org-1",
  streamerId: null,
};

function jsonRequest(
  url: string,
  body: Record<string, unknown>,
  method = "POST",
): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("streamer lifecycle route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getStreamerLifecycleRouteContext).mockResolvedValue({
      supabase,
      auth: {
        userId: opsActor.userId,
        name: opsActor.name,
        role: opsActor.role,
        organizationId: opsActor.organizationId,
      },
      repo: {},
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    vi.mocked(actorFromContext).mockResolvedValue(opsActor);
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it("maps the lifecycle stage payload and returns the streamer", async () => {
    vi.mocked(changeStreamerLifecycleStage).mockResolvedValueOnce({
      id: "streamer-1",
      lifecycleStage: "training",
    } as never);

    const response = await lifecyclePatch(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/lifecycle",
        { stage: "training", reason: "试播通过" },
        "PATCH",
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      streamer: { id: "streamer-1", lifecycleStage: "training" },
    });
    expect(changeStreamerLifecycleStage).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: opsActor,
        streamerId: "streamer-1",
        input: { stage: "training" },
        reason: "试播通过",
      }),
    );
  });

  it("rejects a lifecycle change without reason before touching the service", async () => {
    const response = await lifecyclePatch(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/lifecycle",
        { stage: "training" },
        "PATCH",
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "reason is required",
    });
    expect(changeStreamerLifecycleStage).not.toHaveBeenCalled();
  });

  it("rejects unknown lifecycle stages with 400", async () => {
    const response = await lifecyclePatch(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/lifecycle",
        { stage: "vip", reason: "x" },
        "PATCH",
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(400);
    expect(changeStreamerLifecycleStage).not.toHaveBeenCalled();
  });

  it("returns 403 when the lifecycle service rejects a role permission", async () => {
    vi.mocked(changeStreamerLifecycleStage).mockRejectedValueOnce(
      new Error(
        "Only owner and ops_manager can change streamer lifecycle stage",
      ),
    );

    const response = await lifecyclePatch(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/lifecycle",
        { stage: "training", reason: "x" },
        "PATCH",
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(403);
  });

  it("blocks lifecycle writes when billing is read-only", async () => {
    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );

    const response = await lifecyclePatch(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/lifecycle",
        { stage: "training", reason: "x" },
        "PATCH",
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(403);
    expect(changeStreamerLifecycleStage).not.toHaveBeenCalled();
  });

  it("maps the rating payload", async () => {
    vi.mocked(updateStreamerRating).mockResolvedValueOnce({
      id: "streamer-1",
      rating: "a",
    } as never);

    const response = await ratingPatch(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/rating",
        { rating: "a", reason: "月度评级" },
        "PATCH",
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateStreamerRating).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { rating: "a" },
        reason: "月度评级",
      }),
    );
  });

  it("maps the contract payload including nullable clears", async () => {
    vi.mocked(updateStreamerContract).mockResolvedValueOnce({
      id: "streamer-1",
    } as never);

    const response = await contractPatch(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/contract",
        {
          contractStartDate: "2026-07-01",
          contractEndDate: null,
          revenueShareBps: 5500,
          reason: "签约",
        },
        "PATCH",
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateStreamerContract).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          contractStartDate: "2026-07-01",
          contractEndDate: null,
          revenueShareBps: 5500,
        },
        reason: "签约",
      }),
    );
  });

  it("creates an assessment with 201", async () => {
    vi.mocked(createStreamerAssessment).mockResolvedValueOnce({
      id: "assessment-1",
    } as never);

    const response = await createAssessmentPost(
      jsonRequest("http://localhost/api/streamers/streamer-1/assessments", {
        assessmentType: "trial",
        title: "首场试播",
      }),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      assessment: { id: "assessment-1" },
    });
    expect(createStreamerAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        streamerId: "streamer-1",
        input: expect.objectContaining({
          assessmentType: "trial",
          title: "首场试播",
        }),
      }),
    );
  });

  it("rejects unknown assessment types with 400", async () => {
    const response = await createAssessmentPost(
      jsonRequest("http://localhost/api/streamers/streamer-1/assessments", {
        assessmentType: "final",
        title: "x",
      }),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(400);
    expect(createStreamerAssessment).not.toHaveBeenCalled();
  });

  it("concludes an assessment with the mapped result", async () => {
    vi.mocked(concludeStreamerAssessment).mockResolvedValueOnce({
      id: "assessment-1",
      status: "passed",
    } as never);

    const response = await concludeAssessmentPost(
      jsonRequest(
        "http://localhost/api/streamer-assessments/assessment-1/conclude",
        { result: "passed", score: 88, conclusion: "镜头感好" },
      ),
      { params: Promise.resolve({ assessmentId: "assessment-1" }) },
    );

    expect(response.status).toBe(200);
    expect(concludeStreamerAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: { result: "passed", score: 88, conclusion: "镜头感好" },
      }),
    );
  });

  it("generates attendance records for the organization", async () => {
    vi.mocked(generateAttendanceRecords).mockResolvedValueOnce({
      generated: 3,
      scanned: 5,
    });

    const response = await generateAttendancePost(
      jsonRequest("http://localhost/api/streamer-attendance/generate", {
        until: "2026-07-03T00:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: { generated: 3, scanned: 5 },
    });
    expect(generateAttendanceRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { until: "2026-07-03T00:00:00.000Z" },
      }),
    );
  });

  it("requires a reason for manual attendance corrections", async () => {
    const response = await manualAttendancePost(
      jsonRequest("http://localhost/api/streamer-attendance/manual", {
        liveTaskId: "task-1",
        attendanceStatus: "leave",
      }),
    );

    expect(response.status).toBe(400);
    expect(recordManualAttendance).not.toHaveBeenCalled();
  });

  it("creates a shift change request with the streamer-bound actor", async () => {
    const streamerActor = {
      userId: "user-streamer",
      name: "Streamer",
      role: "streamer" as const,
      organizationId: "org-1",
      streamerId: "streamer-1",
    };
    vi.mocked(actorFromContext).mockResolvedValueOnce(streamerActor);
    vi.mocked(createShiftChangeRequest).mockResolvedValueOnce({
      id: "req-1",
      status: "pending",
    } as never);

    const response = await createShiftChangeRequestPost(
      jsonRequest("http://localhost/api/shift-change-requests", {
        liveTaskId: "task-1",
        requestType: "reschedule",
        proposedStartAt: "2026-07-05T12:00:00.000Z",
        proposedEndAt: "2026-07-05T16:00:00.000Z",
        reason: "临时有事",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      shiftChangeRequest: { id: "req-1", status: "pending" },
    });
    expect(actorFromContext).toHaveBeenCalledWith(expect.anything(), true);
    expect(createShiftChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: streamerActor,
        input: expect.objectContaining({
          liveTaskId: "task-1",
          requestType: "reschedule",
          reason: "临时有事",
        }),
      }),
    );
  });

  it("reviews a shift change request and validates the decision", async () => {
    vi.mocked(reviewShiftChangeRequest).mockResolvedValueOnce({
      id: "req-1",
      status: "approved",
    } as never);

    const ok = await reviewShiftChangeRequestPost(
      jsonRequest("http://localhost/api/shift-change-requests/req-1/review", {
        decision: "approved",
        reviewNote: "同意",
      }),
      { params: Promise.resolve({ requestId: "req-1" }) },
    );
    expect(ok.status).toBe(200);
    expect(reviewShiftChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-1",
        input: { decision: "approved", reviewNote: "同意" },
      }),
    );

    const bad = await reviewShiftChangeRequestPost(
      jsonRequest("http://localhost/api/shift-change-requests/req-1/review", {
        decision: "maybe",
      }),
      { params: Promise.resolve({ requestId: "req-1" }) },
    );
    expect(bad.status).toBe(400);
  });

  it("cancels a shift change request", async () => {
    vi.mocked(cancelShiftChangeRequest).mockResolvedValueOnce({
      id: "req-1",
      status: "cancelled",
    } as never);

    const response = await cancelShiftChangeRequestPost(
      jsonRequest(
        "http://localhost/api/shift-change-requests/req-1/cancel",
        {},
      ),
      { params: Promise.resolve({ requestId: "req-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      shiftChangeRequest: { id: "req-1", status: "cancelled" },
    });
  });

  it("syncs streamer performance for a period", async () => {
    vi.mocked(syncStreamerPerformance).mockResolvedValueOnce({
      id: "snapshot-1",
      broadcastRateBps: 9500,
    } as never);

    const response = await performanceSyncPost(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/performance/sync",
        { periodStart: "2026-06-01", periodEnd: "2026-06-30" },
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      snapshot: { id: "snapshot-1", broadcastRateBps: 9500 },
    });
    expect(syncStreamerPerformance).toHaveBeenCalledWith(
      expect.objectContaining({
        streamerId: "streamer-1",
        input: { periodStart: "2026-06-01", periodEnd: "2026-06-30" },
      }),
    );
  });

  it("applies the operation tier and returns the plan", async () => {
    vi.mocked(applyStreamerOperationTier).mockResolvedValueOnce({
      streamer: { id: "streamer-1", operationTier: "core" },
      plan: { tier: "core", suggestedShareBps: 7000 },
    } as never);

    const response = await operationTierPost(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/operation-tier",
        {},
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      streamer: { id: "streamer-1", operationTier: "core" },
      plan: { tier: "core", suggestedShareBps: 7000 },
    });
  });

  it("blocks tier application when billing is read-only", async () => {
    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );

    const response = await operationTierPost(
      jsonRequest(
        "http://localhost/api/streamers/streamer-1/operation-tier",
        {},
      ),
      { params: Promise.resolve({ streamerId: "streamer-1" }) },
    );

    expect(response.status).toBe(403);
    expect(applyStreamerOperationTier).not.toHaveBeenCalled();
  });
});
