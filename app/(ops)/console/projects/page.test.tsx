import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OpsReferenceApp from "@/components/reference-ui/ops-reference";
import { listOpsLiveTaskQueue } from "@/features/live-operations/live-operations-queries";
import { listProjects } from "@/features/projects/project-queries";
import {
  listPartnerCollaborationApplications,
  listPartnerCollaborationProjects,
} from "@/features/collaborations/project-collaboration-service";
import {
  getOpsSettlementDefaultScope,
  listOpsSettlementBatches,
  listOpsSettlementBatchDetails,
  listOpsSettlementPool,
} from "@/features/settlements/settlement-queries";
import { getAuthContext } from "@/lib/auth/context";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/db/supabase-server";

import ProjectsPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/components/reference-ui/ops-reference", () => ({
  default: vi.fn((props: { currentUser?: { name?: string } }) => (
    <div data-testid="ops-reference-app">
      {props.currentUser?.name ?? "missing-user"}
    </div>
  )),
}));

vi.mock("@/features/projects/project-queries", () => ({
  listProjects: vi.fn(),
}));

vi.mock("@/features/live-operations/live-operations-queries", () => ({
  listOpsLiveTaskQueue: vi.fn(),
}));

vi.mock("@/features/live-operations/live-ui-adapters", () => ({
  toOpsReferenceTask: vi.fn((task) => ({
    id: task.id,
    projectId: task.projectId,
    title: task.title,
  })),
}));

vi.mock("@/features/collaborations/project-collaboration-service", () => ({
  SupabaseProjectCollaborationRepository: vi
    .fn()
    .mockImplementation(function () {
      return {
        type: "collaboration-repo",
      };
    }),
  listPartnerCollaborationApplications: vi.fn(),
  listPartnerCollaborationProjects: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-queries", () => ({
  getOpsSettlementDefaultScope: vi.fn(),
  listOpsSettlementBatches: vi.fn(),
  listOpsSettlementBatchDetails: vi.fn(),
  listOpsSettlementPool: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-ui-adapters", () => ({
  toOpsReferenceBatch: vi.fn((batch) => ({
    id: batch.id,
    projectId: batch.projectId,
    type:
      batch.batchType === "receivable"
        ? "vendor_receivable"
        : "streamer_payable",
    amount: batch.totalAmount,
  })),
  toOpsReferenceBatchDetailItem: vi.fn((item) => ({
    id: item.id,
    streamer: item.streamerName,
  })),
  toOpsReferenceSettlementPoolItem: vi.fn((item) => ({
    id: item.id,
    expected: item.expectedAmount,
  })),
}));

vi.mock("@/lib/auth/context", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseAdminClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

describe("console projects route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      client: "admin-supabase",
    } as never);
    vi.mocked(listPartnerCollaborationApplications).mockResolvedValue([]);
    vi.mocked(listPartnerCollaborationProjects).mockResolvedValue([]);
  });

  it("passes the authenticated staff identity into the ops UI", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-owner",
      email: "owner@example.test",
      name: "Owner User",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "owner",
    });
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([
      {
        id: "task-after-refresh",
        title: "3号 · asd",
        status: "pending_live",
        taskType: "project",
        projectId: "project-1",
        projectName: "3号",
        streamerId: "streamer-1",
        streamerName: "asd",
        plannedStartAt: null,
        plannedEndAt: null,
        plannedDuration: null,
        systemDuration: 0,
      },
    ]);
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([]);
    vi.mocked(getOpsSettlementDefaultScope).mockResolvedValue(null);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);

    render(await ProjectsPage());

    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "Owner User",
    );
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({
        initialRoute: "projects",
        currentUser: expect.objectContaining({
          id: "user-owner",
          name: "Owner User",
          role: "owner",
          dept: "Demo Org",
        }),
        organizationSettings: expect.objectContaining({
          name: "Demo Org",
        }),
        liveTasks: [
          expect.objectContaining({
            id: "task-after-refresh",
            projectId: "project-1",
            title: "3号 · asd",
          }),
        ],
      }),
      undefined,
    );
    expect(listOpsLiveTaskQueue).toHaveBeenCalledWith(supabase, "org-1");
  });

  it("hydrates settlement center data for in-app navigation from the projects entry", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-owner",
      email: "owner@example.test",
      name: "Owner User",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "owner",
    });
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([]);
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([
      {
        id: "batch-real-1",
        projectId: "project-real",
        batchType: "receivable",
        status: "generated",
        title: null,
        projectName: "Real Project",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        computedAmount: 120,
        manualAmount: 0,
        adjustmentAmount: 0,
        totalAmount: 120,
        evidenceSummary: {},
        itemCount: 1,
        createdBy: "Finance",
        updatedAt: "2026-06-03T10:00:00.000Z",
      },
    ]);
    vi.mocked(getOpsSettlementDefaultScope).mockResolvedValue({
      projectId: "project-real",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      poolCount: 1,
    });
    vi.mocked(listOpsSettlementPool).mockResolvedValue([
      {
        id: "report-real-1",
        projectId: "project-real",
        projectName: "Real Project",
        streamerId: "streamer-real-1",
        streamerName: "Streamer One",
        settlementDuration: 120,
        timeSource: "system",
        evidenceLevel: "green",
        settlementMethod: "cpt",
        cpsRateBps: 0,
        expectedAmount: 120,
        approvedAt: "2026-06-03T09:00:00.000Z",
      },
    ]);

    render(await ProjectsPage());

    expect(listOpsSettlementBatches).toHaveBeenCalledWith(supabase, "org-1");
    // B4：projects 入口不再全量预载批次明细——结算中心屏在查看具体批次时
    // 通过 /api/settlement-batches/[batchId] 按需拉取。
    expect(listOpsSettlementBatchDetails).not.toHaveBeenCalled();
    expect(getOpsSettlementDefaultScope).toHaveBeenCalledWith(
      supabase,
      "org-1",
    );
    expect(listOpsSettlementPool).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      projectId: "project-real",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({
        liveBatches: [expect.objectContaining({ id: "batch-real-1" })],
        liveSettlementPool: [expect.objectContaining({ id: "report-real-1" })],
        settlementScope: expect.objectContaining({
          projectId: "project-real",
        }),
      }),
      undefined,
    );
    const props = vi.mocked(OpsReferenceApp).mock.calls[0][0] as {
      liveBatchDetails?: unknown;
    };
    expect(props.liveBatchDetails).toBeUndefined();
  });

  it("still renders when partner collaboration loading fails (degrades to empty)", async () => {
    const supabase = {};
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(getAuthContext).mockResolvedValue({
      userId: "user-owner",
      email: "owner@example.test",
      name: "Owner User",
      organizationId: "org-1",
      organizationName: "Demo Org",
      role: "owner",
    });
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(listOpsLiveTaskQueue).mockResolvedValue([]);
    vi.mocked(listOpsSettlementBatches).mockResolvedValue([]);
    vi.mocked(getOpsSettlementDefaultScope).mockResolvedValue(null);
    vi.mocked(listOpsSettlementPool).mockResolvedValue([]);
    // Simulate a bad service-role key surfacing as a header-encoding error.
    vi.mocked(listPartnerCollaborationProjects).mockRejectedValue(
      new TypeError("Cannot convert argument to a ByteString"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(await ProjectsPage());

    expect(screen.getByTestId("ops-reference-app")).toHaveTextContent(
      "Owner User",
    );
    expect(OpsReferenceApp).toHaveBeenCalledWith(
      expect.objectContaining({ collaborationProjectCards: [] }),
      undefined,
    );
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("redirects unauthenticated visitors to login", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({} as never);
    vi.mocked(getAuthContext).mockResolvedValue(null);

    await expect(Promise.resolve().then(() => ProjectsPage())).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(listProjects).not.toHaveBeenCalled();
  });
});
