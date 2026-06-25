import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH as reviewLiveReportPatch } from "./live-reports/[reportId]/review/route";
import { POST as cancelLiveTaskPost } from "./live-tasks/[taskId]/cancel/route";
import { POST as startLiveTaskPost } from "./live-tasks/[taskId]/start/route";
import { POST as settlementBatchPost } from "./settlement-batches/route";
import { POST as lockSettlementBatchPost } from "./settlement-batches/[batchId]/lock/route";
import { POST as manualSettlementItemPost } from "./settlement-batches/[batchId]/manual-items/route";
import { POST as reopenSettlementBatchPost } from "./settlement-batches/[batchId]/reopen/route";

import {
  actorFromContext,
  getLiveOperationsRouteContext,
} from "@/features/live-operations/live-operations-route-utils";
import {
  cancelLiveTask,
  reviewLiveReport,
  startLiveTask,
} from "@/features/live-operations/live-operations-service";
import { getSettlementRouteContext } from "@/features/settlements/settlement-route-utils";
import {
  addManualSettlementItem,
  generateSettlementBatch,
  lockSettlementBatch,
  reopenSettlementBatch,
} from "@/features/settlements/settlement-service";
import { assertBillingWriteAllowed } from "@/features/billing/route-guard";

vi.mock("@/features/live-operations/live-operations-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/live-operations/live-operations-route-utils")
  >("@/features/live-operations/live-operations-route-utils");

  return {
    ...actual,
    actorFromContext: vi.fn(),
    getLiveOperationsRouteContext: vi.fn(),
  };
});

vi.mock("@/features/live-operations/live-operations-service", () => ({
  cancelLiveTask: vi.fn(),
  reviewLiveReport: vi.fn(),
  startLiveTask: vi.fn(),
}));

vi.mock("@/features/settlements/settlement-route-utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settlements/settlement-route-utils")
  >("@/features/settlements/settlement-route-utils");

  return {
    ...actual,
    getSettlementRouteContext: vi.fn(),
  };
});

vi.mock("@/features/settlements/settlement-service", () => ({
  addManualSettlementItem: vi.fn(),
  generateSettlementBatch: vi.fn(),
  lockSettlementBatch: vi.fn(),
  reopenSettlementBatch: vi.fn(),
}));

vi.mock("@/features/billing/route-guard", () => ({
  assertBillingWriteAllowed: vi.fn(),
}));

const supabase = { client: "supabase" };

const liveActor = {
  userId: "user-streamer",
  name: "Streamer",
  role: "streamer" as const,
  organizationId: "org-1",
  streamerId: "streamer-1",
};

const settlementAuth = {
  userId: "user-finance",
  name: "Finance",
  role: "finance" as const,
  organizationId: "org-1",
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

describe("api route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getLiveOperationsRouteContext).mockResolvedValue({
      supabase,
      auth: {
        userId: liveActor.userId,
        name: liveActor.name,
        role: liveActor.role,
        organizationId: liveActor.organizationId,
      },
      repo: {},
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    vi.mocked(actorFromContext).mockResolvedValue(liveActor);

    vi.mocked(getSettlementRouteContext).mockResolvedValue({
      supabase,
      auth: settlementAuth,
      repo: {},
      audit: vi.fn(),
      notify: vi.fn(),
    } as never);
    vi.mocked(assertBillingWriteAllowed).mockResolvedValue(undefined);
  });

  it("returns 403 when the live-task start service rejects a role permission", async () => {
    vi.mocked(startLiveTask).mockRejectedValueOnce(
      new Error("Current role cannot operate live tasks"),
    );

    const response = await startLiveTaskPost(
      jsonRequest("http://localhost/api/live-tasks/task-1/start", {
        now: "2026-06-02T10:00:00.000Z",
      }),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Current role cannot operate live tasks",
    });
    expect(startLiveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: liveActor,
        taskId: "task-1",
        now: "2026-06-02T10:00:00.000Z",
      }),
    );
  });

  it("maps the M4 cancel-task payload used by the ops UI", async () => {
    vi.mocked(actorFromContext).mockResolvedValueOnce({
      userId: "user-ops",
      name: "Ops Manager",
      role: "ops_manager",
      organizationId: "org-1",
      streamerId: null,
    });
    vi.mocked(cancelLiveTask).mockResolvedValueOnce({
      id: "task-1",
      status: "cancelled",
    } as never);

    const response = await cancelLiveTaskPost(
      jsonRequest("http://localhost/api/live-tasks/task-1/cancel", {
        reason: "经营端页面取消任务",
      }),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      task: { id: "task-1", status: "cancelled" },
    });
    expect(cancelLiveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          userId: "user-ops",
          name: "Ops Manager",
          role: "ops_manager",
          organizationId: "org-1",
          streamerId: null,
        },
        taskId: "task-1",
        reason: "经营端页面取消任务",
      }),
    );
  });

  it("returns 403 when settlement batch generation rejects a role permission", async () => {
    vi.mocked(generateSettlementBatch).mockRejectedValueOnce(
      new Error("Current role cannot manage settlement batches"),
    );

    const response = await settlementBatchPost(
      jsonRequest("http://localhost/api/settlement-batches", {
        projectId: "2ba8b258-b9f6-4ac2-bd3e-b55f686ac608",
        batchType: "payable",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Current role cannot manage settlement batches",
    });
    expect(generateSettlementBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          userId: "user-finance",
          name: "Finance",
          role: "finance",
          organizationId: "org-1",
        },
        input: {
          projectId: "2ba8b258-b9f6-4ac2-bd3e-b55f686ac608",
          batchType: "payable",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
        },
      }),
    );
  });

  it("blocks representative settlement writes while billing is read-only", async () => {
    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );

    const response = await settlementBatchPost(
      jsonRequest("http://localhost/api/settlement-batches", {
        projectId: "project-1",
        batchType: "payable",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Organization is read-only because billing is past due",
    });
    expect(generateSettlementBatch).not.toHaveBeenCalled();
  });

  it("maps the M5 review payload used by the ops UI into the report review service", async () => {
    vi.mocked(actorFromContext).mockResolvedValueOnce({
      userId: "user-ops",
      name: "Ops Manager",
      role: "ops_manager",
      organizationId: "org-1",
      streamerId: null,
    });
    vi.mocked(reviewLiveReport).mockResolvedValueOnce({
      id: "report-1",
      status: "approved",
    } as never);

    const response = await reviewLiveReportPatch(
      jsonRequest(
        "http://localhost/api/live-reports/report-1/review",
        {
          decision: "approve",
          includeInTaskResult: true,
          enterSettlementPool: true,
          reviewNotes: "经营端页面审核",
        },
        "PATCH",
      ),
      { params: Promise.resolve({ reportId: "report-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      report: { id: "report-1", status: "approved" },
    });
    expect(reviewLiveReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: "report-1",
        input: {
          decision: "approve",
          includeInTaskResult: true,
          enterSettlementPool: true,
          reviewNotes: "经营端页面审核",
          reason: undefined,
        },
      }),
    );
  });

  it("blocks representative live-operation writes while billing is read-only", async () => {
    vi.mocked(assertBillingWriteAllowed).mockRejectedValueOnce(
      new Error("Organization is read-only because billing is past due"),
    );

    const response = await startLiveTaskPost(
      jsonRequest("http://localhost/api/live-tasks/task-1/start", {
        now: "2026-06-02T10:00:00.000Z",
      }),
      { params: Promise.resolve({ taskId: "task-1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Organization is read-only because billing is past due",
    });
    expect(startLiveTask).not.toHaveBeenCalled();
  });

  it("maps the M6 create-batch payload and returns the batch plus generated items", async () => {
    vi.mocked(generateSettlementBatch).mockResolvedValueOnce({
      batch: {
        id: "batch-1",
        batchType: "payable",
        status: "generated",
      },
      items: [{ id: "item-1", settlementBatchId: "batch-1" }],
    } as never);

    const response = await settlementBatchPost(
      jsonRequest("http://localhost/api/settlement-batches", {
        projectId: "2ba8b258-b9f6-4ac2-bd3e-b55f686ac608",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        batchType: "payable",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      batch: {
        id: "batch-1",
        batchType: "payable",
        status: "generated",
      },
      items: [{ id: "item-1", settlementBatchId: "batch-1" }],
    });
    expect(generateSettlementBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          projectId: "2ba8b258-b9f6-4ac2-bd3e-b55f686ac608",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          batchType: "payable",
        },
      }),
    );
  });

  it("maps the M6 manual-item payload used by the ops UI", async () => {
    vi.mocked(addManualSettlementItem).mockResolvedValueOnce({
      id: "manual-item-1",
      settlementBatchId: "batch-1",
      itemType: "cpa",
      manualAmount: 300,
    } as never);

    const response = await manualSettlementItemPost(
      jsonRequest(
        "http://localhost/api/settlement-batches/batch-1/manual-items",
        {
          itemType: "cpa",
          manualAmount: 300,
          evidenceLevel: "red",
          reason: "人工录入 CPA/CPS/礼物金额",
          projectId: "project-1",
        },
      ),
      { params: Promise.resolve({ batchId: "batch-1" }) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      item: {
        id: "manual-item-1",
        settlementBatchId: "batch-1",
        itemType: "cpa",
        manualAmount: 300,
      },
    });
    expect(addManualSettlementItem).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-1",
        input: {
          itemType: "cpa",
          projectId: "project-1",
          streamerId: undefined,
          manualAmount: 300,
          adjustmentAmount: undefined,
          evidenceLevel: "red",
          reason: "人工录入 CPA/CPS/礼物金额",
          note: undefined,
        },
      }),
    );
  });

  it("maps the M6 lock payload used by the ops UI", async () => {
    vi.mocked(lockSettlementBatch).mockResolvedValueOnce({
      id: "batch-1",
      status: "locked",
    } as never);

    const response = await lockSettlementBatchPost(
      jsonRequest("http://localhost/api/settlement-batches/batch-1/lock", {
        reason: "财务核对无误",
      }),
      { params: Promise.resolve({ batchId: "batch-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batch: { id: "batch-1", status: "locked" },
    });
    expect(lockSettlementBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-1",
        reason: "财务核对无误",
      }),
    );
  });

  it("maps the M6 reopen payload used by the ops UI", async () => {
    vi.mocked(reopenSettlementBatch).mockResolvedValueOnce({
      id: "batch-1",
      status: "reopened",
    } as never);

    const response = await reopenSettlementBatchPost(
      jsonRequest("http://localhost/api/settlement-batches/batch-1/reopen", {
        reason: "需要修正结算金额",
      }),
      { params: Promise.resolve({ batchId: "batch-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batch: { id: "batch-1", status: "reopened" },
    });
    expect(reopenSettlementBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-1",
        reason: "需要修正结算金额",
      }),
    );
  });
});
