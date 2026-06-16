import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  listOpsLiveReportQueue,
  listOpsLiveTaskQueue,
} from "@/features/live-operations/live-operations-queries";
import { listNotificationCenterItems } from "@/features/notifications/notification-center-queries";
import { listProjects } from "@/features/projects/project-queries";
import { toProjectCardDtos } from "@/features/projects/project-ui-dto";
import {
  listOpsSettlementBatches,
  listOpsSettlementPool,
} from "@/features/settlements/settlement-queries";

import { buildRoleHomeDashboard } from "./role-home";
import { loadRoleHomeDashboard } from "./role-home-loader";

vi.mock("@/features/projects/project-queries", () => ({
  listProjects: vi.fn(),
}));

vi.mock("@/features/projects/project-ui-dto", () => ({
  toProjectCardDtos: vi.fn(),
}));

vi.mock("@/features/live-operations/live-operations-queries", () => ({
  listOpsLiveTaskQueue: vi.fn(),
  listOpsLiveReportQueue: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-queries", () => ({
  listOpsSettlementPool: vi.fn(),
  listOpsSettlementBatches: vi.fn(),
}));

vi.mock("@/features/notifications/notification-center-queries", () => ({
  listNotificationCenterItems: vi.fn(),
}));

vi.mock("./role-home", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./role-home")>();

  return {
    ...actual,
    buildRoleHomeDashboard: vi.fn(actual.buildRoleHomeDashboard),
  };
});

describe("loadRoleHomeDashboard", () => {
  const supabase = {};
  const auth = {
    userId: "user-1",
    email: "owner@example.test",
    name: "Owner",
    organizationId: "org-1",
    organizationName: "Org",
    role: "owner" as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(toProjectCardDtos).mockReturnValue([]);
    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([]);
    vi.mocked(listOpsLiveReportQueue).mockResolvedValue([]);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([]);
    vi.mocked(listNotificationCenterItems).mockResolvedValue([]);
  });

  it("loads dashboard source data scoped to the authenticated organization", async () => {
    const projectRows = [{ id: "project-row-1" }];
    vi.mocked(listProjects).mockResolvedValue(projectRows as never);
    vi.mocked(toProjectCardDtos).mockReturnValue([
      {
        id: "project-1",
        name: "Alpha",
        status: "active",
        leadOps: "Alice",
        metrics: { receivable: 1000, gross: 250 },
        streamers: { active: 1, candidate: 0, pendingReview: 0 },
        risk: "low",
      } as ReturnType<typeof toProjectCardDtos>[number],
    ]);

    const dashboard = await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth,
      now: "2026-06-16T09:30:00.000Z",
    });

    expect(dashboard.profile.role).toBe("owner");
    expect(dashboard.kpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "activeProjects", value: 1 }),
      ]),
    );
    expect(dashboard.queue[0]).toMatchObject({ title: "Alpha" });
    expect(listProjects).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
    });
    expect(toProjectCardDtos).toHaveBeenCalledWith(projectRows);
    expect(listOpsLiveTaskQueue).toHaveBeenCalledWith(supabase, "org-1");
    expect(listOpsLiveReportQueue).toHaveBeenCalledWith(supabase, "org-1");
    expect(listOpsSettlementPool).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      projectId: null,
      batchType: "payable",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(listNotificationCenterItems).toHaveBeenCalledWith(
      supabase,
      {
        userId: "user-1",
        role: "owner",
        organizationId: "org-1",
      },
      { limit: 20 },
    );
  });

  it("maps claimed report timing to a manual dashboard source", async () => {
    vi.mocked(listOpsLiveReportQueue).mockResolvedValue([
      {
        id: "report-claimed",
        taskId: "task-1",
        projectId: "project-1",
        streamerId: "streamer-1",
        status: "pending_review",
        taskTitle: "Task",
        projectName: "Alpha",
        streamerName: "Streamer A",
        settlementDuration: 60,
        timeSource: "claimed",
        evidenceLevel: null,
        viewers: 100,
        submittedAt: "2026-06-16T09:00:00.000Z",
      },
    ]);

    await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth,
      now: "2026-06-16T09:30:00.000Z",
    });

    expect(
      vi.mocked(buildRoleHomeDashboard).mock.calls[0]?.[0].source.reports,
    ).toEqual([
      expect.objectContaining({
        id: "report-claimed",
        source: "manual",
      }),
    ]);
  });

  it("rejects streamer accounts because this loader is staff-only", async () => {
    await expect(
      loadRoleHomeDashboard({
        supabase: supabase as never,
        auth: { ...auth, role: "streamer" },
        now: "2026-06-16T09:30:00.000Z",
      }),
    ).rejects.toThrow(/Only MCN staff/);
  });
});
