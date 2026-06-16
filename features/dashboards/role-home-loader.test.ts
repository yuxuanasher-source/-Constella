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
    const dashboard = await loadRoleHomeDashboard({
      supabase: supabase as never,
      auth,
      now: "2026-06-16T09:30:00.000Z",
    });

    expect(dashboard.profile.role).toBe("owner");
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
